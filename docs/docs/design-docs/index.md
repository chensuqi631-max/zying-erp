# 设计文档索引

设计文档回答「为什么这样做」，代码注释是主要事实来源。

| 文档 | 内容 | 什么时候读 |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | 核心信念：数据真实性、单一收口、二维 BG、可诊断 | 任何改动前 |
| [collection-pipeline.md](collection-pipeline.md) | 采集后流水线：采集 → BG → 按店铺分类 → 只取可售站点 | 改采集/BG/商品字段 |
| [pricing-model.md](pricing-model.md) | 算价口径：承受价公式、K 值、德国 −3、手填优先 | 改算价/税率/上架价 |
| [licensing-auth.md](licensing-auth.md) | 授权（Ed25519+指纹）与各服务鉴权 | 碰授权/token/登录 |

更上层的原则见根目录 [DESIGN.md](../../DESIGN.md)。
