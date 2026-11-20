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
