# Ubuntu 24.04 一键部署

适用于 Ubuntu 24.04 LTS 新服务器（amd64 或 arm64，运行 systemd）。执行命令前无需填写域名、证书邮箱或后台账号。服务器会从 GitHub 拉取 `evilak49-create/rank-qt` 前台和 `evilak49-create/brank` 后台各自默认分支的最新提交。

安装脚本发布到 GitHub 后，公开仓库可在终端运行下面这一行。

```bash
bash -c 'set -e; f=$(mktemp); trap "rm -f -- \"$f\"" EXIT; curl -fsSL https://raw.githubusercontent.com/evilak49-create/brank/main/install-ubuntu.sh -o "$f"; sudo bash "$f"'
```

脚本也可通过 `sudo bash install-ubuntu.sh` 直接执行。私有仓库可为服务器的 root 配置各仓库的只读 Deploy Key，然后通过 `REBATES_FRONTEND_GIT_URL` 和 `REBATES_BACKEND_GIT_URL` 分别指定 SSH 地址。

## 在浏览器完成初始化

1. 在云安全组和服务器防火墙放行 TCP 80 和 443。使用域名时，先将域名解析到服务器。
2. 在脚本运行结束后 30 分钟内，打开 `http://服务器IP/` 或 `http://已解析的域名/`。首次访问会跳转到 `/install`。
3. 输入终端显示的数据库密码，再设置后台账号和密码。页面会根据当前访问地址和本机数据库配置预填其他信息。
4. 提交后，向导会执行迁移、创建管理员并关闭安装页。前台入口为 `/`，管理入口为 `/admin/login`，队列和定时任务随之开始运行。

首次安装使用 HTTP，请在可信网络内完成初始化。向导提交后，脚本根据站点地址为公开域名或公网 IP 申请 Let's Encrypt 证书。签发成功后自动启用 HTTPS、重定向 HTTP 并定期续期。私网 IP 保持 HTTP。证书未签发时可通过 `sudo journalctl -u rebates-install-ssl.service -n 50 --no-pager` 查看原因。

安装授权过期或部署中断时，重新执行同一个命令即可继续。已用旧版脚本安装的站点可重跑新脚本启用自动 HTTPS。

安装目录为 `/var/www/rebates`。站点配置写入 `/var/www/rebates/backend/storage/app/private/site.env`。安装结束后可以运行下列命令查看服务状态。

```bash
sudo systemctl status nginx php8.3-fpm mysql rebates-install-queue.path rebates-install-schedule.timer
sudo journalctl -u rebates-install-queue.service -u rebates-install-schedule.service -n 50 --no-pager
```

## 升级与日常运维

现有站点可以下载最新版脚本并直接升级。私有仓库继续使用首次安装使用的 Git 地址变量和 SSH 密钥。

```bash
bash -c 'set -e; f=$(mktemp); trap "rm -f -- \"$f\"" EXIT; curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/evilak49-create/brank/contents/install-ubuntu.sh?ref=main" -o "$f"; sudo bash "$f" --update'
```

首次安装或升级成功后，也可以在服务器上运行：

```bash
sudo rebates-deploy --update
sudo rebates-deploy --status
sudo rebates-deploy --logs
```

升级先构建两个仓库的最新版，再暂停业务、备份 MySQL、运行迁移、切换版本并检查前台和 API。站点配置、上传和其他持久化文件由各版本共用，现有证书及续期配置继续使用。升级期间前台 API 会暂时进入维护模式。

历史代码版本保存在 `/var/www/rebates/releases/`，数据库备份保存在 `/var/lib/rebates-install/backups/`。迁移或检查失败时，站点会保留维护状态。修正报错后可重新执行升级命令。恢复旧数据库属于单独的运维操作。

## 绑定新的主域名

先将新域名的 A 记录指向服务器公网 IPv4。使用 AAAA 记录时，也要确保该 IPv6 指向服务器且公网可以访问。放行 TCP 80 和 443，等待 DNS 生效。

```bash
sudo rebates-deploy --bind-domain rebates.example.com
```

如果服务器上的运维命令版本较旧，可以直接下载最新版并绑定：

```bash
bash -c 'set -e; f=$(mktemp); trap "rm -f -- \"$f\"" EXIT; curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/evilak49-create/brank/contents/install-ubuntu.sh?ref=main" -o "$f"; sudo bash "$f" --bind-domain "$1"' _ rebates.example.com
```

成功后，新域名成为站点主地址，HTTP 会跳转到新地址的 HTTPS，证书会自动续期。旧地址上的浏览器登录状态不会转移到新域名，请从新域名的 `/admin/login` 重新登录。证书签发或 HTTPS 检查未通过时，现有主地址继续使用。可用 `sudo rebates-deploy --status` 查看站点地址和证书到期时间。

绑定过程中，脚本会等待 Nginx 提供新证书，并在本机 HTTPS 健康检查通过后切换 HTTP 跳转。如果绑定失败，保留终端显示的证书或 HTTP 错误。Nginx 重载日志可用 `sudo journalctl -u nginx -n 60 --no-pager` 查看。
