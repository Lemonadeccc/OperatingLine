# ADR 0088：本地 ProcedureTree revision 编辑工作台

- 状态：已接受
- 日期：2026-08-19

## 背景

不可变 ProcedureTree 资料库、语义检索和证据绑定的局部精修已经能保存、查找及生成新树，但不了解 Blender
的用户仍缺少一个可直接检查树层级、修改参数、留下评论并管理 revision 分支的界面。直接在浏览器内计算 diff、
分配 revision 或覆盖冲突，会使显示结果与持久层权威状态分离；把评论写入树正文又会仅因讨论内容改变执行树
哈希。既有 GuidePlan Revision Workspace 的审批与执行语义也不能复用于 ProcedureTree 知识编辑。

## 决策

Orchestrator 提供本地浏览器工作台 `/procedure-editor#token=<access-token>`。页面只从 URL fragment 读取 token，
写入当前标签页的 `sessionStorage`，随后立即清除 fragment；所有 `/api/v1/procedure/editor/*` 请求都使用
`Authorization: Bearer <access-token>`。静态资源使用同源 CSP、`no-store`、`no-referrer`、禁止 frame 与 MIME
嗅探等响应头。页面本身不内嵌 token，也不把 token 放进查询参数、请求正文或持久层。

工作台读取已有 immutable ProcedureTree，显示 group/leaf 层级、semantic/menu/shortcut/MCP 轨迹及操作，允许
增加或删除节点、移动及重排树层级、修改树与节点文本，并删除或重排已有操作。参数编辑只有一个权威入口：
leaf 的 Action arguments。字段来自树所绑定的 ActionCatalog Schema，并且只有 InteractionCatalog
`procedureMaterialization` 明确声明为 `projected`、完整覆盖且约束能被工作台精确表达时才可编辑；`omitted`、
未知 Schema 关键字、旧树或缺少投影声明的字段保持只读。semantic/menu/shortcut/MCP 参数不能被客户端直接修改。
既有 `semanticAction`、轨迹目标和 provenance 同样只读；操作删除只有在没有目录投影绑定、且剩余轨迹仍完整覆盖
所有 semantic operation 时才开放，界面不会猜测或转移 `semanticRefs`。没有 `parameterProjection` 的历史树即使
缺少对应 InteractionCatalog，仍可编辑标题与安全结构，但全部 Action 参数保持只读。

ProcedureTree 的可选 `parameterProjection` 使用独立格式 `1.0.0`，绑定精确 InteractionCatalog version、recipe ID、
Action argument coverage、转换和 stable target path。路径只接受安全的 field/index segment，禁止原型链特殊字段，
同一操作的目标不能重叠。Blender InteractionCatalog `1.33.0` 首先为 UV Sphere 声明该投影；`1.32.0` 作为冻结
历史目录继续逐字回放。服务端验证投影与目录配方完全一致，再把 Action 修改确定性投影到 semantic、menu 和
shortcut 参数；训练用替代轨迹不会由浏览器按相同值猜测关联。任何编辑都必须先提交完整候选树给服务端 preview；
客户端不自行决定差异、内容哈希或目标 revision。

diff/merge stable path 同样拒绝 `__proto__`、`constructor` 与 `prototype`，避免任何来自 JSON record 的字段路径
触发原型 setter。历史与评论分页在请求开始时冻结 tree、branch head、anchor 和本地 load generation；分支或选择
变化后返回的旧响应会被丢弃，不能混入当前界面。

服务端按 stable ID 对节点及各类 operation 数组生成确定性 diff，并把 base branch head、全局 latest revision、
完整目标树及其 SHA-256 绑定为 preview receipt。Commit 在进入持久层前再次验证 preview、树 Schema 和
ActionCatalog、InteractionCatalog parameter projection 和 compile gate；随后由单个数据库 transaction 核对 branch head 和全局 latest revision，并以
compare-and-swap 分配唯一的下一个 immutable revision。任一 head 或全局 latest 漂移都会 fail closed；精确
request 重试保持幂等。

服务端 mutation policy 保护 tree/catalog identity、source/evidence/provenance、既有 Action identity、轨迹结构中的
可执行目标、anchor/observation/rollback、validation 与 `parameterProjection`。改变 leaf 内容会把其 validation
降为 candidate；改变 group 内容会同时降级所有后代 leaf，客户端不能伪造 verified 状态。只有通过该 policy 的
Action argument 修改才进入目录投影和完整树验证。

每个 branch 保存创建基线，并从 append-only commit lineage 推导独立 head。Merge 只接受两个仍匹配 preview
的 branch head，基于 revision commit DAG 计算唯一最低共同祖先，再按 stable ID 执行确定性三方合并。独立
字段变化可以组合；同字段分歧、删除与编辑竞争、identity 改写、没有共同祖先或存在多个最低共同祖先都会返回
显式冲突。客户端必须按服务端返回的精确冲突顺序为每项选择 target、source、base 或提供 custom operand；缺项、
重复项、重排、篡改 descriptor、非法 identity 选择或与参数投影不一致的混合选择都 fail closed。重新 preview
会把完整 resolutions 绑定进 receipt，commit 再从当前三方输入重算同一结果。成功 merge 仍产生一个新的全局
immutable revision，不改写任何历史树。

评论是绑定 branch lineage、精确 tree revision 和 tree/node/track/operation anchor 的 append-only 记录，不是
ProcedureTree 正文，因此不参与树的 canonical SHA-256。Schema 19 持久保存 branch、revision commit 和 comment；
工作台在 Orchestrator 重启后可以恢复分支 head、提交历史和评论。

## 公共入口

页面使用以下全部受 Bearer 鉴权的 `POST` 入口：

- `/api/v1/procedure/editor/branches/create`
- `/api/v1/procedure/editor/branches/get`
- `/api/v1/procedure/editor/branches/list`
- `/api/v1/procedure/editor/workspaces/get`
- `/api/v1/procedure/editor/history/list`
- `/api/v1/procedure/editor/edits/preview`
- `/api/v1/procedure/editor/merges/preview`
- `/api/v1/procedure/editor/commits/create`
- `/api/v1/procedure/editor/comments/create`
- `/api/v1/procedure/editor/comments/list`
- `/api/v1/procedure/editor/parameters/form`

公开请求和结果使用 `ProcedureTreeEditor 1.0.0` 严格协议与生成的 JSON Schema。Branch、history 和 comment list
使用显式游标；workspace 返回 branch head 的完整树与完整性摘要。生成的 JSON Schema 只负责可静态表达的结构；
parameter form 的 metadata/value 兄弟字段依赖及 projection/catalog 关系由运行时 Zod 与目录验证权威执行，Schema
以 `$comment` 明示该边界。

## 后果与边界

- 不懂 Blender 的用户可以在本地可视化树中检查及调整层级与替代轨迹，调整标题、意图和目录证明的安全参数，添加锚点评论，
  再通过 preview/commit、branch 和 fail-closed merge 保存可追溯 revision。
- 编辑、评论和 merge 不创建 GuideProposal、不接受或发布 GuidePlan，也不执行 Blender 或其他宿主动作；
  branch create、preview、commit 和 parameter form 结果显式保持 `proposalCreated=false` 与
  `hostExecutionStarted=false`。
- 这是已有树的人工 revision 工作台，不从一句话零基线生成完整 ProcedureTree，不调用 Provider，不自动做
  semantic replan，也不把评论或 candidate interaction 当成训练真值。
- 评论不改变树哈希，但仍是本地持久数据；token 只保留在当前标签页不等于操作系统凭据库或多用户权限系统。

## 验证

- 协议与 JSON Schema 覆盖 branch、workspace、stable-ID diff、edit/merge preview、commit、history、comment 和
  parameter form，并拒绝未知字段；运行时 Zod 合同继续拒绝跨字段不一致的 revision/tree identity；
- persistence tests 覆盖 schema 19 migration、branch head、全局 revision CAS、edit/merge commit、幂等冲突、
  comment anchor lineage 及重启读取；
- coordinator tests 覆盖 stable-ID diff、唯一最低共同祖先、逐冲突 resolution、混合投影冲突拒绝、
  ActionCatalog/InteractionCatalog 参数表单、append-only comment 和过期 preview；
- HTTP/UI tests 覆盖 Bearer API、静态资源安全响应头、fragment token 清理、编辑提交、分支合并、评论与重启恢复。
