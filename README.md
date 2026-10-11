# Fengyan Lin — Personal Homepage

静态主页，无需构建或安装前端依赖。页面结构在 `index.html`，样式在 `assets/css/site.css`，交互和数据渲染在 `assets/js/site.js`。

## 本地预览

在仓库根目录运行：

```sh
python3 -m http.server 4000 --bind 127.0.0.1
```

打开 <http://127.0.0.1:4000>。修改后刷新页面即可；请通过 HTTP 预览，直接打开 HTML 文件无法加载 YAML。图标和 YAML 解析器使用 CDN，需要联网。

## 新增论文与幻灯片

将幻灯片放进 `slides/`，再编辑 `data/publications.yml`。例如：

```yaml
- title: "Paper title"
  year: 2026
  conference: "CHI 2026"
  conference_short: "CHI"
  authors:
    - name: "Fengyan Lin"
      emphasis: true
    - name: "Coauthor"
      url: "https://example.com/"
  image: "/images/publications/example.jpg"
  url: "https://example.com/paper"
  pdf: "/PDF/publications/example.pdf"
  video: "https://example.com/video"
  code: "https://example.com/code"
  slides: "/slides/example.pptx"
  keywords: [HCI, Education]
  abstract: "Paper abstract."
```

- `title` 为论文标题。`year` 用于从新到旧排序，同年保持 YAML 顺序；未填年份的条目排在最后。
- `pdf`、`video`、`code`、`slides` 都是可选项。未填写或为空时不显示按钮；`slides` 也支持 PDF 或在线演示链接。浏览器通常会下载 PPTX。
- `url` 是标题指向的论文页面。旧的 `href` 字段仍作为 `pdf` 的兼容别名；新条目只需使用 `pdf`，避免维护重复路径。
- 分类按钮从 `keywords` 自动生成，支持 YAML 数组或 `"Education, HCI"` 这样的逗号分隔字符串。
- `image`、`abstract` 和作者链接均可省略；没有缩略图时正文自动占满整行。
- 会议徽标可使用 `conference_logo` 和 `conference_url`。`conference_short` 对应 CSS 中的 `tag-chi` 等样式，未配置的会议使用默认样式。
- 论文标题、摘要和作者姓名按纯文本显示，直接填写 `&`、引号等字符即可。
- 文件路径以 `/` 开头表示站点根目录，大小写必须与 **Git 记录**一致。现有 PDF 目录在 Git 中为 `PDF/`；macOS 文件系统可能显示成 `pdf/`。

新增论文、分类或 SLIDES 链接不需要修改 HTML/JS。需要增加全新的资源类型时，在 `assets/js/site.js` 的 `PUBLICATION_RESOURCES` 数组添加一项 `key`、`label` 和 Font Awesome `icon`，随后在 YAML 中填写对应字段即可。按钮顺序由该数组决定。

## 字体与排版

全站使用同一套无衬线字体栈，以 Avenir Next 为首选，包含 Windows 与中文字体回退；按钮继承正文的字体。无需加载额外的网络字体。

教育栏目的透明校徽使用 `.education-logo` 容器。`--logo-surface` 在浅色模式为透明，在深色模式为浅灰底，保证原图的深色文字清晰；无需反色或修改校徽文件。容器留白在两种主题中保持一致，切换主题不会改变校徽尺寸或文字排版。手机端统一使用 72×72px 正方形容器，内留 12px，校徽保持比例并居中；桌面端保留横版。

论文的会议 LOGO 使用 `.pub-logo-surface`，共享同一个主题底色，底板随图片宽度收缩，四周留 8px，保留横版比例和会议链接。以后在 YAML 添加 `conference_logo` 就会自动应用，无需逐个调整深色模式。

排版变量集中在 `assets/css/site.css` 顶部的 `:root`：

| 用途 | 变量 | 字号范围 |
| --- | --- | --- |
| 英文姓名 | `--text-name` | 34–56px |
| 中文姓名 | `--text-name-cn` | 18–22px |
| 栏目标题 | `--text-section` | 22–26px |
| 论文标题 | `--text-title` | 19–23px |
| 正文 | `--text-body` | 16–18px |
| 日期、作者、摘要 | `--text-meta` | 15px |
| 资源链接与控件 | `--text-ui` | 14px |
| 说明文字 | `--text-note` | 13px |

字号以 `rem` 定义，表中像素值按浏览器默认 16px 根字号换算。姓名、标题和正文使用 `clamp()` 随视口平滑变化。字重统一为 400／500／600，正文行高为 1.7，信息文字为 1.55；长段落由 `--prose-width` 限制行宽。新增栏目优先复用现有变量与 `.section-heading`，避免另写一组断点字号。

600px 及以下的窄屏中，中文名独占一行并与英文名左对齐；较宽屏幕空间充足时保持中英文并排。英文姓名允许自然换行，`(Daniel) Lin` 作为一组避免姓氏单独掉行；极窄屏中英文名可分成两行，中文名接在下方。手机顶部为操作按钮预留一行，避免遮挡姓名。

## 新闻与检查

新闻在 `data/news.yml` 中维护，按文件顺序显示，每页三条。日期建议使用引号；`text` 支持作者自行编写的 HTML（例如 `<strong>`），不要放入未经审核的外部 HTML。

提交前检查：

```sh
node --check assets/js/site.js
git diff --check
```

本地确认桌面/窄屏布局、明暗主题、分类筛选和摘要展开，并点击新增资源检查路径。提交时需同时包含 YAML 修改和对应资源文件。
