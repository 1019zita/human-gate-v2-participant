# Human Gate v2 participant surface

**状态：正式研究参与者前端。**

本页面面向中国法学生和其他研究参与人员，使用中文呈现研究说明、案件材料、判断任务和证据质询流程。

## 运行

```bash
npm install
npm run dev
npm run build
```

## 参与者流程

1. 阅读欢迎页上的研究说明；
2. 填写姓名、年龄和性别，并确认已阅读说明；
3. 根据案件材料独立作出判断；
4. 阅读服务端分配的 AI 辅助材料；
5. 完成 AI 后判断、证据质询、最终判断和材料呈现检验；
6. 系统保存判断、置信度和页面交互事件。

前端不收集邮箱或密码。登录身份由 Supabase 匿名会话提供；姓名、年龄和性别在创建研究会话时通过 `hg2-api` 写入 Supabase 的参与者记录。浏览器不会选择实验条件，服务端负责条件分配、事件顺序、时间戳、事件哈希链和试次锁定。

## 数据边界

- 浏览器只使用 Supabase URL、anon/publishable key 和研究材料；
- service-role key、模型密钥、Gold、裁决标签、相关性标签和正确性标签不会进入前端；
- 参与者可见的 AI 信息仅作为辅助依据，不作为标准答案；
- 参与者信息和事件记录仅用于本研究分析，具体保存和访问控制由 Supabase/RLS 负责。

参与者材料来自版本化 `HG2-0003` artifact manifest。前端只读取案情、AI 呈现材料和标准化质询材料，不读取离线 Gold 或评估文件。HG2-0003 同时提供参与者可见的摘要、核心理由、反向证据、冲突/缺口/不确定性字段；内部 hypothesis IDs/refs 和 Gold-dependent fields 不进入 participant payload。

正式参与者页面部署使用 `supabase/migrations/20261027000000_hg2_release_readiness.sql`、`supabase/migrations/20261027000001_formal_participant_onboarding.sql`、`supabase/migrations/20261027000002_formal_flow_repair.sql`、`supabase/migrations/20261027000003_ux_validity_repair.sql` 和 `supabase/functions/hg2-api/index.ts`。当前 Pages URL 为 `https://1019zita.github.io/human-gate-v2-participant/`；正式招募前仍需伦理、隐私、RLS/运营审查与当前浏览器 E2E 验证。
