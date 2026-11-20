#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

usage() {
    cat <<'EOF'
用法：sudo bash install-ubuntu.sh [--update | --bind-domain 域名 | --status | --logs]
  无参数     安装环境或重新应用部署配置
  --update   拉取两个仓库的最新代码，备份数据库并升级
  --bind-domain 域名   绑定新的主域名并自动启用 HTTPS
  --status   查看运行状态和当前代码版本
  --logs     查看最近的队列、调度和 HTTPS 日志

适用于 Ubuntu 24.04 LTS（amd64 / arm64）的新站点。开放 TCP 80 后，
通过服务器 IP 或域名打开浏览器安装向导，并创建后台账号。
向导完成后，自动为安装地址申请和续期 Let's Encrypt 证书。公网需开放 TCP 80 和 443。
脚本从 GitHub 拉取前台 rank-qt 和后台 brank 的默认分支最新提交。
私有仓库可用 REBATES_FRONTEND_GIT_URL 和 REBATES_BACKEND_GIT_URL 指定 SSH 地址。
安装中断后可用相同参数重试。完整说明见 deploy/Ubuntu-24.04-安装.md。
EOF
}

die() { printf '安装失败：%s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
    usage
    exit 0
fi
action=${1:-install}
bind_domain=
case "$action" in
    --bind-domain)
        if (( $# != 2 )); then usage >&2; exit 2; fi
        bind_domain=${2,,}
        bind_domain=${bind_domain%.}
        dns_label='[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'
        if [[ ${#bind_domain} -gt 253 || ! $bind_domain =~ ^($dns_label\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
            die '请输入域名，如 rebates.example.com，省略协议、端口和路径。'
        fi
        ;;
    install|--update|--status|--logs)
        if (( $# > 1 )); then usage >&2; exit 2; fi
        ;;
    *) usage >&2; exit 2 ;;
esac
(( EUID == 0 )) || die '请使用 sudo bash 运行。'

. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || die '需要 Ubuntu 24.04 LTS。'
[[ -d /run/systemd/system ]] || die '需要运行 systemd 的服务器。'
case "$(dpkg --print-architecture)" in
    amd64) node_arch=x64 ;;
    arm64) node_arch=arm64 ;;
    *) die '仅支持 amd64 / arm64。' ;;
esac

app=/var/www/rebates
state=/var/lib/rebates-install
frontend_git_url=${REBATES_FRONTEND_GIT_URL:-https://github.com/evilak49-create/rank-qt.git}
backend_git_url=${REBATES_BACKEND_GIT_URL:-${REBATES_GIT_URL:-https://github.com/evilak49-create/brank.git}}
runtime=rebates-app
php=/usr/bin/php8.3
nginx_site=/etc/nginx/sites-available/rebates-install.conf
nginx_link=/etc/nginx/sites-enabled/rebates-install.conf
pool=/etc/php/8.3/fpm/pool.d/rebates-install.conf
socket=/run/php/rebates-install.sock
queue=/etc/systemd/system/rebates-install-queue.service
schedule=/etc/systemd/system/rebates-install-schedule.service
timer=/etc/systemd/system/rebates-install-schedule.timer
queue_path=/etc/systemd/system/rebates-install-queue.path
ssl_service=/etc/systemd/system/rebates-install-ssl.service
ssl_timer=/etc/systemd/system/rebates-install-ssl.timer
ssl_path=/etc/systemd/system/rebates-install-ssl.path
ssl_helper=/usr/local/libexec/rebates-install-ssl
nginx_parts=/etc/nginx/rebates-install
acme_root=/var/www/rebates-acme
deploy_command=/usr/local/sbin/rebates-deploy
backend=$app/backend
site_env=$backend/storage/app/private/site.env
update_marker=$state/update-in-progress

active_revisions() {
    if [[ -f $app/current/revisions ]]; then
        cat "$app/current/revisions"
    elif [[ -d $state/backend-source/.git && -d $state/frontend-source/.git ]]; then
        printf 'backend %s\nfrontend %s\n' \
            "$(git -C "$state/backend-source" rev-parse HEAD)" \
            "$(git -C "$state/frontend-source" rev-parse HEAD)"
    fi
}

if [[ $action == --status || $action == --logs ]]; then
    [[ -f $state/browser-install ]] || die '未找到部署记录。'
    if [[ $action == --logs ]]; then
        journalctl --no-pager -n 100 -u nginx -u php8.3-fpm -u mysql \
            -u rebates-install-queue.service -u rebates-install-schedule.service -u rebates-install-ssl.service
        if [[ -f $backend/storage/logs/laravel.log ]]; then
            printf '\nLaravel\n'
            tail -n 60 "$backend/storage/logs/laravel.log"
        fi
        exit 0
    fi
    active_revisions
    if [[ -s $site_env ]]; then
        runuser -u "$runtime" -- sed -n 's/^APP_URL="\([^"]*\)"$/站点地址：\1/p' "$site_env"
    fi
    if [[ -f $nginx_parts/https-site.conf ]]; then
        cert_file=$(awk '$1 == "ssl_certificate" { sub(/;$/, "", $2); print $2; exit }' "$nginx_parts/https-site.conf")
        if [[ -s $cert_file ]]; then openssl x509 -in "$cert_file" -noout -enddate; fi
    fi
    if [[ -f $update_marker ]]; then printf '有一次升级尚未结束。\n'; fi
    for unit in nginx php8.3-fpm mysql rebates-install-queue.service \
        rebates-install-schedule.timer rebates-install-ssl.timer; do
        printf '%-34s %s\n' "$unit" "$(systemctl is-active "$unit" || true)"
    done
    exit 0
fi

exec 9>/run/lock/rebates-install.lock
flock -n 9 || die '已有一个安装进程在运行。'

if [[ ! -f $state/browser-install ]]; then
    [[ $action == install ]] || die '请先完成首次安装。'
    for path in "$app" "$nginx_site" "$nginx_link" "$pool" "$queue" "$queue_path" "$schedule" "$timer" \
        "$ssl_service" "$ssl_timer" "$ssl_path" "$ssl_helper" "$nginx_parts" "$acme_root"; do
        [[ ! -e $path && ! -L $path ]] || die "目标已存在：$path"
    done
    if id "$runtime" >/dev/null 2>&1; then die "系统账号已存在：$runtime"; fi
    install -d -m 0700 "$state"
    touch "$state/browser-install"
fi

build_dir=
source_tmp=
update_sources=
cleanup() {
    if [[ -n $build_dir ]]; then rm -rf -- "$build_dir"; fi
    if [[ -n $source_tmp ]]; then rm -rf -- "$source_tmp"; fi
    if [[ -n $update_sources ]]; then rm -rf -- "$update_sources"; fi
    if [[ $action == --update && -f $update_marker ]]; then
        printf '升级尚未结束。请查看上方错误，数据库备份在 %s/backups。修复后可重试 --update。\n' "$state" >&2
    fi
}
trap cleanup EXIT
trap 'printf "安装中断（脚本第 %s 行）。解决上方报错后可用原命令重试。\n" "$LINENO" >&2' ERR

project_path() {
    local checkout=$1 subdir=$2 manifest=$3 lockfile=$4 path
    for path in "$checkout/$subdir" "$checkout"; do
        if [[ -f $path/$manifest && -f $path/$lockfile ]]; then
            printf '%s\n' "$path"
            return 0
        fi
    done
    return 1
}

checkout_source() {
    local label=$1 git_url=$2 source_dir=$3 subdir=$4 manifest=$5 lockfile=$6
    if [[ ! -d $source_dir ]]; then
        step "拉取${label}仓库的默认分支"
        source_tmp=$(mktemp -d "$state/.source.XXXXXXXX")
        git clone --depth 1 --single-branch -- "$git_url" "$source_tmp" ||
            die "无法拉取${label}仓库。请检查仓库地址、网络和读取权限。"
        project_path "$source_tmp" "$subdir" "$manifest" "$lockfile" >/dev/null ||
            die "${label}仓库的根目录或 $subdir/ 目录需要包含 $manifest 和 $lockfile。"
        mv -T -- "$source_tmp" "$source_dir"
        source_tmp=
    fi
    step "${label}源码提交 $(git -C "$source_dir" rev-parse --short HEAD)"
}

mysql_root() { mysql --no-defaults --protocol=socket -uroot --batch --skip-column-names "$@"; }

prepare_build() {
    step '安装 Laravel 生产依赖并构建 Vue 前台'
    # Stay on the deployment filesystem so publishing each build is a rename.
    build_dir=$(mktemp -d "$app/.build.XXXXXXXX")
    chown "$runtime:$runtime" "$build_dir"
    chmod 0700 "$build_dir"
}

build_backend() {
    mkdir "$build_dir/backend"
    rsync -r --exclude='/.env*' --exclude='/vendor' --exclude='/node_modules' \
        --exclude='/storage/***' --exclude='/bootstrap/cache/***' \
        --exclude='/public/hot' --exclude='/public/storage' \
        --exclude='/.git' --exclude='/database/*.sqlite*' "$backend_source/" "$build_dir/backend/"
    install -d "$build_dir/backend"/{bootstrap/cache,storage/app/private,storage/app/public,storage/logs}
    install -d "$build_dir/backend"/storage/framework/{cache/data,sessions,views}
    chown -R "$runtime:$runtime" "$build_dir/backend"
    (
        cd "$build_dir/backend"
        runuser -u "$runtime" -- env HOME="$build_dir" COMPOSER_HOME="$build_dir/composer" \
            "$php" /usr/bin/composer install --no-dev --optimize-autoloader --prefer-dist --no-interaction
        runuser -u "$runtime" -- "$php" artisan filament:assets --no-interaction
    )
    chown -hR root:root "$build_dir/backend"
    chown -hR "$runtime:$runtime" "$build_dir/backend/storage" "$build_dir/backend/bootstrap/cache"
    chmod 0700 "$build_dir/backend/storage/app/private"
    mkdir -p "$build_dir/backend/public/"{css,js,fonts}
    chown -hR "$runtime:$runtime" "$build_dir/backend/public/"{css,js,fonts}
}

build_frontend() {
    node_url=https://nodejs.org/dist/latest-v24.x
    (
        cd "$build_dir"
        curl -fsSL --retry 3 "$node_url/SHASUMS256.txt" -o SHASUMS256.txt
        awk -v arch="$node_arch" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$")' \
            SHASUMS256.txt > node.sha256
        [[ $(wc -l <node.sha256) == 1 ]]
        read -r _ archive <node.sha256
        version=${archive#node-}
        version=${version%-linux-*}
        curl -fsSL --retry 3 "https://nodejs.org/dist/$version/$archive" -o "$archive"
        sha256sum --check node.sha256
        mkdir node frontend
        tar -xJf "$archive" --no-same-owner --strip-components=1 -C node
        rsync -r --exclude='/.env*' --exclude='/.git' --exclude='/node_modules' --exclude='/dist' \
            "$frontend_source/" frontend/
        chown -R "$runtime:$runtime" frontend
        cd frontend
        runuser -u "$runtime" -- env HOME="$build_dir" PATH="$build_dir/node/bin:/usr/bin:/bin" npm ci --no-audit --no-fund
        runuser -u "$runtime" -- env HOME="$build_dir" PATH="$build_dir/node/bin:/usr/bin:/bin" npm run build
    )
    test -s "$build_dir/frontend/dist/index.html"
    chown -hR root:root "$build_dir/frontend/dist"
}

save_deploy_command() {
    local script=${BASH_SOURCE[0]}
    if [[ -f $script && ! $script -ef $deploy_command ]]; then
        install -m 0755 "$script" "$deploy_command.new"
        mv -f -- "$deploy_command.new" "$deploy_command"
    fi
}

initialize_release_layout() {
    local original=$app/releases/initial
    install -d -m 0755 "$original" "$app/shared"
    if [[ ! -L $app/current ]]; then
        if [[ -d $backend && ! -L $backend ]]; then mv -- "$backend" "$original/backend"; fi
        if [[ -d $app/frontend && ! -L $app/frontend ]]; then mv -- "$app/frontend" "$original/frontend"; fi
        if [[ -d $original/backend/storage && ! -L $original/backend/storage ]]; then
            mv -- "$original/backend/storage" "$app/shared/storage"
        fi
        if [[ ! -L $original/backend/storage ]]; then
            ln -s "$app/shared/storage" "$original/backend/storage"
        fi
        ln -s releases/initial "$app/current"
    fi
    if [[ ! -L $backend ]]; then ln -s current/backend "$backend"; fi
    if [[ ! -L $app/frontend ]]; then ln -s current/frontend "$app/frontend"; fi
}

upgrade_artisan() (
    local directory=$1
    shift
    cd "$directory"
    runuser -u "$runtime" -- "$php" artisan "$@"
)

upgrade_site() {
    if [[ -d $app/releases/initial ]]; then initialize_release_layout; fi
    [[ -s $site_env && -f $backend/public/rebates-install.php && -s $app/frontend/index.html ]] ||
        die '请先通过浏览器完成安装。'
    update_sources=$(mktemp -d "$state/.update.XXXXXXXX")
    checkout_source 后台 "$backend_git_url" "$update_sources/backend" backend composer.json composer.lock
    checkout_source 前台 "$frontend_git_url" "$update_sources/frontend" frontend package.json package-lock.json
    backend_source=$(project_path "$update_sources/backend" backend composer.json composer.lock)
    frontend_source=$(project_path "$update_sources/frontend" frontend package.json package-lock.json)
    local revisions
    revisions=$(printf 'backend %s\nfrontend %s\n' \
        "$(git -C "$update_sources/backend" rev-parse HEAD)" \
        "$(git -C "$update_sources/frontend" rev-parse HEAD)")
    if [[ ! -f $update_marker && $revisions == "$(active_revisions)" ]]; then
        printf '当前前后台已是最新版本。\n'
        return
    fi

    prepare_build
    build_backend
    build_frontend
    install -m 0644 "$backend/public/rebates-install.php" "$build_dir/backend/public/rebates-install.php"
    install -d -m 0755 "$app/releases"
    local release backup
    release=$(mktemp -d "$app/releases/$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
    chmod 0755 "$release"
    mv -- "$build_dir/backend" "$release/backend"
    mv -- "$build_dir/frontend/dist" "$release/frontend"
    printf '%s\n' "$revisions" >"$release/revisions"
    chmod 0750 "$release/backend/bootstrap/cache"

    step '暂停业务进程并备份数据库'
    touch "$update_marker"
    upgrade_artisan "$backend" down --retry=60 --no-interaction
    systemctl stop rebates-install-queue.path rebates-install-schedule.timer
    systemctl stop rebates-install-queue.service rebates-install-schedule.service
    install -d -m 0700 "$state/backups"
    backup="$state/backups/${release##*/}.sql.gz"
    (
        umask 077
        mysqldump --no-defaults --protocol=socket -uroot --single-transaction --quick \
            --no-tablespaces --set-gtid-purged=OFF --databases rebates_app | gzip >"$backup.partial"
        mv -- "$backup.partial" "$backup"
    )
    printf '数据库备份：%s\n' "$backup"

    step '执行数据库迁移并切换前后台'
    initialize_release_layout
    mv -- "$release/backend/storage" "$build_dir/unused-storage"
    ln -s "$app/shared/storage" "$release/backend/storage"
    upgrade_artisan "$release/backend" migrate --force --no-interaction
    upgrade_artisan "$release/backend" view:clear --no-interaction
    ln -sfn -- "releases/${release##*/}" "$app/current.new"
    mv -Tf -- "$app/current.new" "$app/current"
    systemctl reload php8.3-fpm
    upgrade_artisan "$backend" up --no-interaction

    local health
    local -a probe=(-fsSL --max-time 20 --noproxy '*' --proto-redir '=https' --connect-to '::127.0.0.1:')
    if ! health=$(curl "${probe[@]}" http://127.0.0.1/api/v1/health) ||
        [[ $health != '{"status":"ok"}' ]] ||
        ! curl "${probe[@]}" http://127.0.0.1/api/v1/content/banners >/dev/null ||
        ! curl "${probe[@]}" http://127.0.0.1/ | cmp -s - "$app/frontend/index.html"; then
        upgrade_artisan "$backend" down --retry=60 --no-interaction
        die '新版本的前台或 API 检查失败。'
    fi
    systemctl start rebates-install-queue.path rebates-install-schedule.timer
    systemctl start rebates-install-queue.service
    rm -- "$update_marker"
    printf '\n升级完成。当前版本\n%s\n' "$revisions"
}

configure_nginx() {
install -d -m 0755 "$nginx_parts" "$acme_root"
cat >"$nginx_parts/app.conf" <<EOF
    root $app/frontend;
    client_max_body_size 24m;

    location = / { rewrite ^ /rebates-install.php last; }
    location = /install { rewrite ^ /rebates-install.php last; }
    location = /index.html { try_files \$uri =404; }
    location ~ ^/(?:index|rebates-install)\.php\$ {
        internal;
        root $backend/public;
        include fastcgi.conf;
        fastcgi_pass unix:$socket;
    }
    location ~ /\. { return 404; }
    location ~* \.php(?:/|\$) { return 404; }
    location /assets/ { try_files \$uri =404; }
    location ~ ^/(?:css|js|fonts|vendor)/ {
        root $backend/public;
        try_files \$uri =404;
    }
    location = /robots.txt {
        root $backend/public;
        try_files \$uri =404;
    }
    location / { rewrite ^ /index.php last; }
EOF
cat >"$nginx_site.new" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    include $nginx_parts/http-*.conf;
    location ^~ /.well-known/acme-challenge/ {
        root $acme_root;
        try_files \$uri =404;
    }
    include $nginx_parts/app.conf;
}
include $nginx_parts/https-*.conf;
EOF
# Ubuntu's stock default occupies port 80. Leave custom defaults in place.
nginx_default=/etc/nginx/sites-enabled/default
stock_default=
if [[ -L $nginx_default && $(readlink -f "$nginx_default") == /etc/nginx/sites-available/default ]]; then
    expected=$(dpkg-query -W -f='${Conffiles}' nginx-common | awk '$1=="/etc/nginx/sites-available/default" { print $2 }')
    actual=$(md5sum /etc/nginx/sites-available/default | cut -d' ' -f1)
    if [[ $actual == "$expected" ]]; then
        stock_default=$(readlink "$nginx_default")
        rm -- "$nginx_default"
    fi
fi
if [[ -f $nginx_site ]]; then cp -- "$nginx_site" "$nginx_site.previous"; fi
mv -- "$nginx_site.new" "$nginx_site"
ln -sfn -- "$nginx_site" "$nginx_link"
if ! nginx -t; then
    if [[ -f $nginx_site.previous ]]; then
        mv -- "$nginx_site.previous" "$nginx_site"
    else
        rm -f -- "$nginx_link" "$nginx_site"
    fi
    if [[ -n $stock_default ]]; then ln -s -- "$stock_default" "$nginx_default"; fi
    die 'Nginx 配置校验失败，请检查 TCP 80 的默认站点配置。'
fi
rm -f -- "$nginx_site.previous"
systemctl reload nginx
}

configure_ssl() {
step '配置自动 HTTPS'
install -d -m 0755 /usr/local/libexec
cat >"$ssl_helper.new" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

config=/var/www/rebates/backend/storage/app/private/site.env
parts=/etc/nginx/rebates-install
webroot=/var/www/rebates-acme
venv=/var/lib/rebates-install/certbot
if [[ ! -s $config ]]; then exit 0; fi
if [[ -f /var/lib/rebates-install/update-in-progress ]]; then exit 0; fi
requested=${1:-}
exec 8>/run/lock/rebates-install-ssl.lock
if [[ -n $requested ]]; then
    flock -w 600 8
else
    flock -n 8 || exit 0
fi

identifier=$(runuser -u rebates-app -- /usr/bin/python3 - "$config" "$requested" <<'PY'
import ipaddress
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

env = Path(sys.argv[1]).read_text()
match = re.search(r'^APP_URL="([^"]+)"$', env, re.M)
if not match:
    sys.exit(0)
try:
    url = urlsplit(f"https://{sys.argv[2]}" if sys.argv[2] else match[1])
    host = url.hostname
    if url.scheme not in ("http", "https") or not host or url.username or url.password:
        sys.exit(0)
    if url.port not in (None, 80, 443) or url.path not in ("", "/") or url.query or url.fragment:
        sys.exit(0)
except ValueError:
    sys.exit(0)
try:
    ip = ipaddress.ip_address(host)
except ValueError:
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if len(host) <= 253 and re.fullmatch(rf"(?:{label}\.)+[a-z](?:[a-z0-9-]{{0,61}}[a-z0-9])?", host):
        print("domain", host, host)
else:
    if ip.is_global and not ip.is_multicast and "%" not in host:
        print("ip", ip, str(ip) if ip.version == 4 else f"[{ip}]")
PY
)
if [[ -z $identifier ]]; then
    if [[ -n $requested ]]; then printf '无法读取站点地址或域名无效。\n' >&2; exit 1; fi
    exit 0
fi
read -r kind host authority <<<"$identifier"

if [[ $kind == ip ]]; then
    names=(--preferred-profile shortlived --ip-address "$host")
    verify=(-verify_ip "$host")
    default_tls=' default_server'
    renew_before=$(( 3 * 86400 ))
else
    names=(-d "$host")
    verify=(-verify_hostname "$host")
    default_tls=
    renew_before=$(( 30 * 86400 ))
fi

matches_certificate() {
    [[ -s $1/fullchain.pem && -s $1/privkey.pem ]] &&
        openssl verify -partial_chain -trusted "$1/fullchain.pem" "${verify[@]}" "$1/fullchain.pem" >/dev/null 2>&1
}

# A failed request for a new host must preserve the current certificate lineage.
live=/etc/letsencrypt/live
host_key=$(printf '%s' "$host" | sha256sum | cut -c1-24)
lineage=rebates-install-$host_key
if [[ ! -d $live/$lineage ]] && matches_certificate "$live/rebates-install"; then
    lineage=rebates-install
fi
cert=$live/$lineage
issued=false
if ! matches_certificate "$cert" ||
    ! openssl x509 -in "$cert/fullchain.pem" -noout -checkend "$renew_before" >/dev/null; then
    if [[ ! -x $venv/bin/certbot ]]; then
        /usr/bin/python3 -m venv "$venv"
        "$venv/bin/python" -m pip --disable-pip-version-check install 'certbot>=5.4,<6'
    fi
    "$venv/bin/certbot" certonly --non-interactive --agree-tos --register-unsafely-without-email \
        --webroot -w "$webroot" --cert-name "$lineage" --keep-until-expiring "${names[@]}"
    matches_certificate "$cert" || { printf '证书与 %s 不匹配。\n' "$host" >&2; exit 1; }
    issued=true
fi

new_config=$(mktemp -d "$parts/.tls.XXXXXXXX")
trap 'rm -rf -- "$new_config"' EXIT
cat >"$new_config/https-site.conf" <<EOF
server {
    listen 443 ssl$default_tls;
    listen [::]:443 ssl$default_tls;
    server_name $authority;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    include $parts/app.conf;
}
EOF
cat >"$new_config/http-redirect.conf" <<EOF
    if (\$uri !~ "^/\\.well-known/acme-challenge/") {
        return 301 https://$authority\$request_uri;
    }
EOF

files=(https-site.conf http-redirect.conf)
restore_nginx() {
    local file
    for file in "${files[@]}"; do
        if [[ -f $new_config/$file.previous ]]; then
            mv -f -- "$new_config/$file.previous" "$parts/$file"
        else
            rm -f -- "$parts/$file"
        fi
    done
    nginx -t && systemctl reload nginx
}

abort_nginx_change() {
    printf '%s\n' "$1" >&2
    if restore_nginx; then
        printf '已恢复之前的 Nginx 配置。\n' >&2
    else
        printf '未能重新加载原 Nginx 配置，请检查 nginx 服务日志。\n' >&2
    fi
    exit 1
}

wait_for_https() {
    local attempt status detail
    for ((attempt=1; attempt<=10; attempt++)); do
        if status=$(curl --disable -sS --noproxy '*' --connect-to '::127.0.0.1:443' \
            --connect-timeout 2 --max-time 3 --output "$new_config/health-body" --write-out '%{http_code}' \
            "https://$authority/api/v1/health" 2>"$new_config/health-error"); then
            if [[ $status == 200 && $(<"$new_config/health-body") == '{"status":"ok"}' ]]; then return 0; fi
            detail="HTTPS 返回 HTTP $status，健康接口未返回预期结果。"
        else
            detail=$(<"$new_config/health-error")
        fi
        if (( attempt < 10 )); then sleep 1; fi
    done
    printf '本机 HTTPS 检查未通过（%s）：%s\n' "$authority" "$detail" >&2
    return 1
}

changed=false
if ! cmp -s "$new_config/https-site.conf" "$parts/https-site.conf" ||
    ! cmp -s "$new_config/http-redirect.conf" "$parts/http-redirect.conf"; then
    for file in "${files[@]}"; do
        if [[ -f $parts/$file ]]; then cp -- "$parts/$file" "$new_config/$file.previous"; fi
    done
    mv -- "$new_config/https-site.conf" "$parts/https-site.conf"
    changed=true
    if ! nginx -t || ! systemctl reload nginx; then
        abort_nginx_change '无法启用新域名的 Nginx HTTPS 配置。'
    fi
    if ! wait_for_https; then
        abort_nginx_change '新地址的 HTTPS 未就绪，未切换 HTTP 跳转。'
    fi

    if ! cmp -s "$new_config/http-redirect.conf" "$parts/http-redirect.conf"; then
        mv -- "$new_config/http-redirect.conf" "$parts/http-redirect.conf"
        if ! nginx -t || ! systemctl reload nginx; then
            abort_nginx_change '无法启用新域名的 HTTP 跳转。'
        fi
    fi
elif [[ $issued == true ]]; then
    nginx -t
    systemctl reload nginx
fi

# Write as the application account so no site-owned path is written as root.
if ! env_change=$(runuser -u rebates-app -- /usr/bin/python3 - "$config" "$authority" <<'PY'
import os
import re
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
contents = path.read_text()
updated = re.sub(r'^APP_URL="[^"]+"$', f'APP_URL="https://{sys.argv[2]}"', contents, flags=re.M)
updated = re.sub(r'^SESSION_SECURE_COOKIE="[^"]+"$', 'SESSION_SECURE_COOKIE="true"', updated, flags=re.M)
if updated == contents:
    sys.exit(0)
with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temp:
    temp.write(updated)
os.replace(temp.name, path)
print("changed")
PY
); then
    if [[ $changed == true ]]; then restore_nginx; fi
    exit 1
fi
if [[ $env_change == changed ]]; then
    systemctl try-restart rebates-install-queue.service
fi
BASH
chmod 0755 "$ssl_helper.new"
mv -f -- "$ssl_helper.new" "$ssl_helper"
cat >"$ssl_service" <<EOF
[Unit]
Description=Issue and renew the Rebates HTTPS certificate
After=network-online.target nginx.service
Wants=network-online.target
ConditionPathExists=$site_env

[Service]
Type=oneshot
ExecStart=$ssl_helper
TimeoutStartSec=10min
EOF
cat >"$ssl_path" <<EOF
[Unit]
Description=Check HTTPS after browser installation

[Path]
PathChanged=$site_env

[Install]
WantedBy=multi-user.target
EOF
cat >"$ssl_timer" <<'EOF'
[Unit]
Description=Check the Rebates HTTPS certificate

[Timer]
OnBootSec=1min
OnCalendar=*-*-* *:00,15,30,45:00
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

if [[ $action == --bind-domain ]]; then
    [[ ! -f $update_marker && -s $site_env ]] || die '请先完成安装或正在进行的升级。'
    getent ahosts "$bind_domain" >/dev/null || die '服务器还无法解析该域名，请检查 DNS。'
    if [[ $(dpkg-query -W -f='${Status}' python3-venv 2>/dev/null || true) != 'install ok installed' ]]; then
        apt-get install -y python3-venv
    fi
    configure_nginx
    configure_ssl
    systemctl daemon-reload
    step "为 $bind_domain 验证 DNS 并申请证书"
    "$ssl_helper" "$bind_domain" || die '域名绑定失败，请查看上方证书签发或 HTTPS 检查的报错。'
    systemctl enable --now rebates-install-ssl.path rebates-install-ssl.timer
    save_deploy_command
    printf '\n已绑定新的主域名：https://%s/\n后台：https://%s/admin/login\n' "$bind_domain" "$bind_domain"
    exit 0
fi

if [[ $action == --update ]]; then
    upgrade_site
    save_deploy_command
    exit 0
fi

[[ ! -f $update_marker ]] || die '有一次升级尚未结束，请使用 --update 继续。'
export DEBIAN_FRONTEND=noninteractive
apt-get update
if [[ ! -d $backend || ! -d $app/frontend ]]; then
    apt-get install -y git ca-certificates openssh-client
    checkout_source 后台 "$backend_git_url" "$state/backend-source" backend composer.json composer.lock
    checkout_source 前台 "$frontend_git_url" "$state/frontend-source" frontend package.json package-lock.json
    backend_source=$(project_path "$state/backend-source" backend composer.json composer.lock)
    frontend_source=$(project_path "$state/frontend-source" frontend package.json package-lock.json)
fi

step '安装 Nginx、MySQL、PHP 8.3 和 Composer'
apt-get install -y nginx mysql-server composer rsync curl ca-certificates openssl unzip xz-utils python3-venv \
    php8.3-cli php8.3-fpm php8.3-mysql php8.3-mbstring php8.3-xml php8.3-curl \
    php8.3-intl php8.3-zip php8.3-gd php8.3-bcmath
if ! id "$runtime" >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --home-dir "$app" --shell /usr/sbin/nologin "$runtime"
fi
install -d -m 0755 "$app"
systemctl enable --now mysql nginx php8.3-fpm

if [[ ! -d $backend || ! -d $app/frontend ]]; then
    prepare_build
    if [[ ! -d $backend ]]; then
        build_backend
        mv -- "$build_dir/backend" "$backend"
    fi
    if [[ ! -d $app/frontend ]]; then
        build_frontend
        mv -- "$build_dir/frontend/dist" "$app/frontend"
    fi
fi

step '配置本机数据库和浏览器安装授权'
chmod 0750 "$backend/bootstrap/cache"
if [[ ! -f $site_env ]]; then
    if [[ ! -f $state/database-password ]]; then
        existing=$(mysql_root -e "SELECT
          (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='rebates_app') +
          (SELECT COUNT(*) FROM mysql.user WHERE User='rebates_app');")
        [[ $existing == 0 ]] || die 'MySQL 中已存在 rebates_app 数据库或用户。'
        (umask 077; openssl rand -hex 32 >"$state/database-password.new")
        mv -- "$state/database-password.new" "$state/database-password"
    fi
    db_password=$(<"$state/database-password")
    [[ $db_password =~ ^[a-f0-9]{64}$ ]] || die '安装数据库密码状态无效。'
    mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS rebates_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'rebates_app'@'127.0.0.1' IDENTIFIED BY '$db_password';
GRANT ALL PRIVILEGES ON rebates_app.* TO 'rebates_app'@'127.0.0.1';
SQL
    (
        cd "$backend"
        printf '%s\n' "$db_password" | runuser -u "$runtime" -- "$php" -r '
            require "vendor/autoload.php";
            $app = require "bootstrap/app.php";
            $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            $db = [
                "db_host" => "127.0.0.1",
                "db_port" => 3306,
                "db_name" => "rebates_app",
                "db_user" => "rebates_app",
                "db_password" => trim(fgets(STDIN)),
            ];
            $access = $app->make(App\Installation\InstallerAccess::class);
            exit($access->enable("http://rebates-install.invalid", $db) ? 0 : 1);
        '
    )
fi

step '配置 PHP-FPM 和 HTTP 入口'
cat >"$pool" <<EOF
[rebates-install]
user = $runtime
group = $runtime
listen = $socket
listen.owner = www-data
listen.group = www-data
listen.mode = 0660
pm = ondemand
pm.max_children = 8
php_admin_value[upload_max_filesize] = 20M
php_admin_value[post_max_size] = 24M
EOF
/usr/sbin/php-fpm8.3 -t
systemctl reload php8.3-fpm

cat >"$backend/public/rebates-install.php" <<'PHP'
<?php

use Illuminate\Http\Request;
use Illuminate\View\View;

$backend = dirname(__DIR__);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/' && is_file($backend.'/storage/app/private/site.env')) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(dirname(__DIR__, 2).'/frontend/index.html');
    return;
}

define('LARAVEL_START', microtime(true));
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->booted(static function (): void {
    view()->composer('install', static function (View $view): void {
        $values = $view->getData()['values'];
        if (($values['app_url'] ?? null) === 'http://rebates-install.invalid') {
            $values['app_url'] = request()->getSchemeAndHttpHost();
        }
        $view->with('values', $values + ['db_name' => 'rebates_app', 'db_user' => 'rebates_app']);
    });
});
$app->handleRequest(Request::capture());
PHP

configure_nginx
configure_ssl

step '配置队列和定时任务'
cat >"$queue" <<EOF
[Unit]
Description=Rebates Laravel queue
After=mysql.service
ConditionPathExists=$site_env

[Service]
User=$runtime
WorkingDirectory=$backend
ExecStart=$php $backend/artisan queue:work --sleep=3 --timeout=60
Restart=always
RestartSec=5
TimeoutStopSec=75

[Install]
WantedBy=multi-user.target
EOF
cat >"$queue_path" <<EOF
[Unit]
Description=Start the Rebates queue after browser installation

[Path]
PathExists=$site_env

[Install]
WantedBy=multi-user.target
EOF
cat >"$schedule" <<EOF
[Unit]
Description=Rebates Laravel scheduler
After=mysql.service
ConditionPathExists=$site_env

[Service]
Type=oneshot
User=$runtime
WorkingDirectory=$backend
ExecStart=$php $backend/artisan schedule:run --no-interaction
EOF
cat >"$timer" <<'EOF'
[Unit]
Description=Run the Rebates Laravel scheduler every minute

[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now rebates-install-queue.path rebates-install-schedule.timer \
    rebates-install-ssl.path rebates-install-ssl.timer
systemctl is-active --quiet rebates-install-queue.path
systemctl is-active --quiet rebates-install-schedule.timer

step '验证本机 HTTP 入口'
if [[ -f $site_env ]]; then
    curl -fsS --noproxy '*' --max-time 20 http://127.0.0.1/ >/dev/null
    systemctl start --no-block rebates-install-ssl.service
    printf '\n站点已安装。后台入口：/admin/login。自动 HTTPS 会在后台检查。\n'
else
    wizard=$(curl -fsS --noproxy '*' --max-time 20 http://127.0.0.1/install)
    [[ $wizard == *'http://127.0.0.1'* && $wizard != *'http://rebates-install.invalid'* ]] ||
        die '浏览器安装页未正确生成。'
    printf '\n服务器部署完成。请在 30 分钟内打开 http://服务器IP或域名/install\n'
    printf '网站地址和 MySQL 连接信息会自动填入。\n'
    printf '本次安装的数据库密码：%s\n' "$db_password"
    printf '请在安装页填写数据库密码并创建后台账号。安装完成后从 /admin/login 登录。\n'
    printf '公开域名或公网 IP 的 HTTPS 会在安装向导完成后自动签发，请开放 TCP 80 和 443。\n'
fi
save_deploy_command
