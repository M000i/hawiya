# Hawiya · هوية

[العربية](#العربية) · [English](#english)

<div dir="rtl">

## العربية

### ما هي هوية؟

أداة مفتوحة تختار بها **الهوية البصرية لواجهة تطبيقك** بعينك قبل بنائه: الألوان، والخطوط، والزوايا، والظلال، والأيقونات،
والأزرار، والكروت، والمسافات، والاتجاه (يمين أو يسار أو الاثنان). تدعم العربية والإنجليزية، وترى اختيارك على أربع شاشات
معاينة قبل اعتماده.

النتيجة ستة ملفات في مجلد `design/` داخل مشروعك، يلتزم بها أي وكيل برمجة (Claude Code أو Codex أو غيرهما):

| الملف | ما هو |
|---|---|
| `identity.json` | الأصل: كل الملفات الأخرى تُولَّد منه |
| `DESIGN.md` | القواعد التي يتبعها وكيل البرمجة |
| `tokens.json` | القيم بصيغة W3C Design Tokens |
| `tokens.css` | القيم كمتغيرات CSS للوضعين الفاتح والداكن |
| `theme.css` | تنسيقات جاهزة للأزرار والكروت والنصوص |
| `style-guide.html` | صفحة تعرض الهوية كاملة |

تعمل على مشاريع الويب: صفحات الهبوط، والمواقع، وتطبيقات الويب، ولوحات التحكم، وصفحات HTML المستقلة.

### التثبيت كمهارة

**ما تحتاجه:** git، ومتصفح حديث. وللحفظ التلقائي في مشروعك: Node 18 أو أحدث، أو Python 3.8 أو أحدث (أغلب أجهزة
Mac و Linux فيها Python). بدونهما تعمل الأداة أيضًا، لكن تنسخ النتيجة بيدك.

انسخ المستودع في مجلد المهارات الخاص بوكيلك. اسم المجلد يجب أن يكون `hawiya`.

**Claude Code** (لكل مشاريعك):

</div>

```bash
git clone https://github.com/M000i/hawiya.git ~/.claude/skills/hawiya
```

<div dir="rtl">

أو لمشروع واحد فقط: انسخه داخل المشروع في `.claude/skills/hawiya`.

**Codex** (لكل مشاريعك):

</div>

```bash
git clone https://github.com/M000i/hawiya.git ~/.codex/skills/hawiya
```

<div dir="rtl">

أو لمشروع واحد فقط: انسخه داخل المشروع في `.agents/skills/hawiya`.

على Windows استبدل `~` بمجلد المستخدم، مثل `%USERPROFILE%\.claude\skills\hawiya`.
افتح جلسة جديدة للوكيل بعد التثبيت ليتعرّف على المهارة. وللتحديث لاحقًا: `git pull` داخل مجلد `hawiya`.

المستودع: https://github.com/M000i/hawiya

### الاستخدام مع الوكيل

1. افتح مشروعك عند الوكيل واكتب: **«اختر هوية الواجهة لهذا المشروع»**.
2. يقرأ الوكيل مشروعك (نوعه، ولغته، وألوان علامتك إن وُجدت)، ثم يفتح صفحة الاختيار في متصفحك.
3. اختر هوية جاهزة، أو أجب عن الأسئلة الثمانية، أو اختر كل عنصر بنفسك، ثم اضغط **«تصدير»**.
4. تُحفظ الملفات الستة في `design/`، ويضيف الوكيل سطرًا واحدًا في `CLAUDE.md` أو `AGENTS.md` يلزمه باتباع
   `design/DESIGN.md`. من الآن يبني الوكيل واجهتك بهذه الهوية.

إذا شغّلت المهارة مرة ثانية على المشروع نفسه، يسألك الوكيل قبل استبدال الهوية الحالية، وينقل القديمة إلى
`design/backup-…/` ولا يحذفها. ولا يتكرر سطر الالتزام.

المهارة مصممة للمحادثة العادية مع الوكيل، لأنها تنتظر ضغطك على «تصدير».

### الاستخدام من الصفحة المنشورة (بلا تثبيت)

افتح الصفحة https://m000i.github.io/hawiya/ واختر، ثم اضغط «تصدير». بعدها:

- **«انسخ للوكيل»:** ينسخ تعليمات قصيرة مع الملفات. الصقها في محادثة وكيلك داخل مشروعك، فيكتب الملفات بنفسه.
  (لا يشمل `style-guide.html` لطوله.)
- **«تنزيل الملفات الستة (zip)»:** ملف `hawiya-design.zip` فيه مجلد `design` بالملفات الستة. فك ضغطه في مجلد مشروعك الرئيسي، ثم أضف
  لوكيلك سطرًا يقول: اتبع `design/DESIGN.md` في كل عمل على الواجهة.

### الخصوصية والاتصال بالإنترنت

الخطوط تُحمَّل من **Google Fonts**، فتحتاج الصفحة اتصالًا بالإنترنت لتظهر الخطوط على حقيقتها، وهذا هو الاتصال الخارجي
الوحيد. لا حسابات، ولا تتبّع، ولا إحصاءات. اختياراتك تُحفظ في متصفحك فقط. وخادم الحفظ يعمل على جهازك
(`127.0.0.1`) ويكتب في `design/` فقط، ثم يُغلق.

### للمطوّرين

</div>

```bash
npm install
npm test
npm run check
npm run dev
```

<div dir="rtl">

- `npm test`: كل الاختبارات. `npm run check`: فحص المكتبة والتراخيص و `SKILL.md`.
- `npm run dev`: يشغّل خادم الحفظ على المشروع التجريبي `sandbox/` ويطبع رابط الصفحة.
- `npm run build`: يبني بيانات الصفحة من المكتبة. `npm run review`: صفحة مراجعة التمبلتات.

### الرخصة

MIT (انظر `LICENSE`). المصادر الخارجية (الألوان والخطوط والأيقونات) ورخصها في `THIRD_PARTY_NOTICES.md`.

</div>

---

## English

### What is Hawiya?

An open tool to choose your app's **visual UI identity** by eye before you build it: colors, fonts, corners, shadows,
icons, buttons, cards, spacing and direction (RTL, LTR or both). Arabic-first and bilingual, with four preview screens
that show your choice before you commit.

The result is six files in your project's `design/` folder that any coding agent (Claude Code, Codex, ...) follows:

| File | What it is |
|---|---|
| `identity.json` | The source: every other file is generated from it |
| `DESIGN.md` | The rules your coding agent follows |
| `tokens.json` | The values as W3C Design Tokens |
| `tokens.css` | The values as CSS variables, light and dark |
| `theme.css` | Ready-made styles for buttons, cards and text |
| `style-guide.html` | A page that shows the whole identity |

It is for web projects: landing pages, websites, web apps, dashboards and standalone HTML pages.

### Install as a skill

**You need:** git and a modern browser. To save straight into your project: Node 18+ or Python 3.8+ (most Macs and
Linux machines have Python). Without them it still works, but you copy the result by hand.

Clone the repository into your agent's skills folder. The folder must be named `hawiya`.

**Claude Code** (all your projects):

```bash
git clone https://github.com/M000i/hawiya.git ~/.claude/skills/hawiya
```

Or for one project only: clone it into `.claude/skills/hawiya` inside that project.

**Codex** (all your projects):

```bash
git clone https://github.com/M000i/hawiya.git ~/.codex/skills/hawiya
```

Or for one project only: clone it into `.agents/skills/hawiya` inside that project.

On Windows, replace `~` with your user folder, e.g. `%USERPROFILE%\.claude\skills\hawiya`. Start a new agent session
after installing so it finds the skill. To update later, run `git pull` inside the `hawiya` folder.

Repository: https://github.com/M000i/hawiya

### Use it with your agent

1. Open your project in the agent and say: **"Choose the UI identity for this project"** (or in Arabic,
   «اختر هوية الواجهة لهذا المشروع»).
2. The agent reads your project (type, language, existing brand colors) and opens the picker in your browser.
3. Pick a ready identity, answer the eight guided questions, or choose each element yourself, then press
   **Export** («تصدير» on the Arabic page).
4. The six files are saved in `design/`, and the agent adds one line to `CLAUDE.md` or `AGENTS.md` telling it to follow
   `design/DESIGN.md`. From now on it builds your UI with this identity.

Run it again on the same project and the agent asks before replacing the current identity; the old files move to
`design/backup-…/` and are never deleted. The commit line is never added twice.

The skill is made for a normal, interactive chat with your agent, because it waits for you to press Export.

### Use the published page (no install)

Open https://m000i.github.io/hawiya/, choose, press Export, then:

- **Copy for the agent** («انسخ للوكيل»): copies short instructions with the files. Paste them into your agent's chat inside
  your project and it writes the files. (It leaves out `style-guide.html`, which is long.)
- **Download the six files (zip)** («تنزيل الملفات الستة (zip)»): `hawiya-design.zip` holds a `design` folder with all six files. Unzip it into your project's
  root folder, then tell your agent: follow `design/DESIGN.md` for all UI work.

### Privacy and network

Fonts are loaded from **Google Fonts**, so the page needs an internet connection to show them; that is its only
outside connection. No accounts, no tracking, no analytics. Your choices are kept in your browser only. The save server
runs on your own machine (`127.0.0.1`), writes only inside `design/`, then closes.

### For developers

```bash
npm install
npm test
npm run check
npm run dev
```

- `npm test`: all tests. `npm run check`: checks the library, licenses and `SKILL.md`.
- `npm run dev`: starts the save server on the `sandbox/` test project and prints the page link.
- `npm run build`: builds the page data from the library. `npm run review`: the template review page.

### License

MIT (see `LICENSE`). Third-party sources (colors, fonts, icons) and their licenses are in `THIRD_PARTY_NOTICES.md`.
