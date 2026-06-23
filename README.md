# 火山方舟 Pro 席位用量看板

React + Vite 页面，用于查询火山方舟企业版 Coding Plan Pro 档位订阅席位，并展示每个席位的 5 小时用量、近一周用量、近一月用量和套餐生效时间。

## 启动

1. 安装依赖：

```bash
npm install
```

2. 创建本地环境变量文件：

```bash
cp .env.example .env
```

3. 在 `.env` 中填入火山引擎 AK/SK。如果使用临时凭据，也填入 `VOLCENGINE_SESSION_TOKEN`。

4. 启动开发服务：

```bash
npm run dev
```

前端地址：`http://localhost:5173/`

API 地址：`http://localhost:8787/`

## 数据流

- 前端请求本地 `/api/seats`。
- Express 服务端调用 `ListSeatInfos`，固定使用 `Filter.BizInfo=Pro`，并按 `PageNum` / `PageSize` 分页读取全部席位。
- 服务端把获取到的 `SeatID` 批量传给 `ListSeatInfoUsages`。
- 前端只接收归一化后的展示数据，AK/SK 不进入浏览器。

## 构建

```bash
npm run build
```

构建产物在 `dist/`，生产预览可运行：

```bash
npm run preview
```
