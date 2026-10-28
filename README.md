# Human Gate v2 participant surface

**状态：正式研究参与者前端。**

本页面面向中国法学生和其他研究参与人员，使用中文呈现研究说明、案件材料、三步判断任务和研究结束材料呈现评价。

## 运行

```bash
npm install
npm run dev
npm run build
```

## 参与者流程

1. 阅读欢迎页上的研究说明；
2. 填写姓名、年龄和性别，并确认已阅读说明；
3. 每个案件在同一页面阅读案件事实并完成独立判断；
4. 阅读服务端按独立判断绑定的 AI 辅助材料；
5. 完成 AI 后判断；该案件立即锁定并进入下一案件；
6. 三个案件完成后，在一个页面分别评价任务一、任务二、任务三的 AI 信息易理解程度、信息量合适程度和信任程度；
7. 统一评价保存后，系统正式完成会话。

每案只包含独立判断、AI 信息和 AI 后判断三步；participant flow 不包含 challenge、第三次/最终判断或逐案 manipulation check。

前端不收集邮箱或密码。登录身份由 Supabase 匿名会话提供；姓名、年龄和性别在创建研究会话时通过 `hg2-api` 写入 Supabase 的参与者记录。浏览器不会选择实验条件，服务端负责条件分配、事件顺序、时间戳、事件哈希链和试次锁定。

## 数据边界

- 浏览器只使用 Supabase URL、anon/publishable key 和研究材料；
- service-role key、模型密钥、Gold、裁决标签、相关性标签和正确性标签不会进入前端；
- 参与者可见的 AI 信息仅作为辅助依据，不作为标准答案；
- 参与者信息和事件记录仅用于本研究分析，具体保存和访问控制由 Supabase/RLS 负责。

参与者材料来自版本化 `HG2-0004` artifact manifest。前端只读取案情和 AI 呈现材料，不读取离线 Gold 或评估文件。HG2-0004 的 C2 单元包含从冻结检索/AUDIT 数据计算的描述性材料覆盖说明；内部 hypothesis IDs/refs 和 Gold-dependent fields 不进入 participant payload。

正式参与者页面部署使用 `supabase/migrations/20261027000000_hg2_release_readiness.sql`、`supabase/migrations/20261027000001_formal_participant_onboarding.sql`、`supabase/migrations/20261027000002_formal_flow_repair.sql`、`supabase/migrations/20261027000003_ux_validity_repair.sql`、`supabase/migrations/20261029000000_formal_allocation_cursor.sql`、`supabase/migrations/20261029000001_three_step_protocol.sql`、`supabase/migrations/20261029000002_fix_post_study_event.sql`、`supabase/migrations/20261029000003_fix_finalize_session.sql` 和 `supabase/functions/hg2-api/index.ts`。当前 Pages URL 为 `https://1019zita.github.io/human-gate-v2-participant/`；正式招募前仍需伦理、隐私、RLS/运营审查与当前浏览器 E2E 验证。
