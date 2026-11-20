#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

usage() {
    cat <<'EOF'
用法：sudo bash install-ubuntu.sh

适用于 Ubuntu 24.04 LTS（amd64 / arm64）的新站点。开放 TCP 80 后，
通过服务器 IP 或域名打开浏览器安装向导，并创建后台账号。
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
if (( $# != 0 )); then usage >&2; exit 2; fi
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

exec 9>/run/lock/rebates-install.lock
flock -n 9 || die '已有一个安装进程在运行。'

if [[ ! -f $state/browser-install ]]; then
    for path in "$app" "$nginx_site" "$nginx_link" "$pool" "$queue" "$queue_path" "$schedule" "$timer"; do
        [[ ! -e $path && ! -L $path ]] || die "目标已存在：$path"
    done
    if id "$runtime" >/dev/null 2>&1; then die "系统账号已存在：$runtime"; fi
    install -d -m 0700 "$state"
    touch "$state/browser-install"
fi

build_dir=
source_tmp=
cleanup() {
    if [[ -n $build_dir ]]; then rm -rf -- "$build_dir"; fi
    if [[ -n $source_tmp ]]; then rm -rf -- "$source_tmp"; fi
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

export DEBIAN_FRONTEND=noninteractive
apt-get update
if [[ ! -d $app/backend || ! -d $app/frontend ]]; then
    apt-get install -y git ca-certificates openssh-client
    checkout_source 后台 "$backend_git_url" "$state/backend-source" backend composer.json composer.lock
    checkout_source 前台 "$frontend_git_url" "$state/frontend-source" frontend package.json package-lock.json
    backend_source=$(project_path "$state/backend-source" backend composer.json composer.lock)
    frontend_source=$(project_path "$state/frontend-source" frontend package.json package-lock.json)
fi

step '安装 Nginx、MySQL、PHP 8.3 和 Composer'
apt-get install -y nginx mysql-server composer rsync curl ca-certificates openssl unzip xz-utils \
    php8.3-cli php8.3-fpm php8.3-mysql php8.3-mbstring php8.3-xml php8.3-curl \
    php8.3-intl php8.3-zip php8.3-gd php8.3-bcmath
if ! id "$runtime" >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --home-dir "$app" --shell /usr/sbin/nologin "$runtime"
fi
install -d -m 0755 "$app"
systemctl enable --now mysql nginx php8.3-fpm

mysql_root() { mysql --no-defaults --protocol=socket -uroot --batch --skip-column-names "$@"; }

if [[ ! -d $app/backend || ! -d $app/frontend ]]; then
    step '安装 Laravel 生产依赖并构建 Vue 前台'
    # Stay on the deployment filesystem so publishing each build is a rename.
    build_dir=$(mktemp -d "$app/.build.XXXXXXXX")
    chown "$runtime:$runtime" "$build_dir"
    chmod 0700 "$build_dir"
    if [[ ! -d $app/backend ]]; then
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
        mv -- "$build_dir/backend" "$app/backend"
    fi

    if [[ ! -d $app/frontend ]]; then
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
        mv -- "$build_dir/frontend/dist" "$app/frontend"
    fi
fi

step '配置本机数据库和浏览器安装授权'
backend=$app/backend
site_env=$backend/storage/app/private/site.env
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

cat >"$nginx_site.new" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
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
}
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
systemctl enable --now rebates-install-queue.path rebates-install-schedule.timer
systemctl is-active --quiet rebates-install-queue.path
systemctl is-active --quiet rebates-install-schedule.timer

step '验证本机 HTTP 入口'
if [[ -f $site_env ]]; then
    curl -fsS --noproxy '*' --max-time 20 http://127.0.0.1/ >/dev/null
    printf '\n站点已安装。后台入口：http://服务器IP或域名/admin/login\n'
else
    wizard=$(curl -fsS --noproxy '*' --max-time 20 http://127.0.0.1/install)
    [[ $wizard == *'http://127.0.0.1'* && $wizard != *'http://rebates-install.invalid'* ]] ||
        die '浏览器安装页未正确生成。'
    printf '\n服务器部署完成。请在 30 分钟内打开 http://服务器IP或域名/install\n'
    printf '网站地址和 MySQL 连接信息会自动填入。\n'
    printf '本次安装的数据库密码：%s\n' "$db_password"
    printf '请在安装页填写数据库密码并创建后台账号。安装完成后从 /admin/login 登录。\n'
fi
