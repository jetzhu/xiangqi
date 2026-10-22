// The mailer's emails: fixed text in both languages (the recipient's first), filled with a few
// values. Users never write any of it. docs/v0.4-design.md, M23 (and M24 for parents).

export interface Rendered {
  subject: string;
  text: string;
}
type Lang = "en" | "zh";
type Data = Record<string, unknown>;

const SIGN = { en: "Xiangqi School", zh: "象棋学堂" };
const both = (lang: Lang, en: string, zh: string) => (lang === "zh" ? `${zh}\n\n——\n\n${en}` : `${en}\n\n——\n\n${zh}`);

const TEMPLATES: Record<string, (lang: Lang, d: Data, site: string) => Rendered> = {
  "guardian-confirm": (lang, d, site) => {
    const link = `${site}/${lang}/guardian/?t=${String(d.token)}`;
    const student = String(d.student);
    const coach = String(d.coach);
    return {
      subject: lang === "zh" ? `请确认：${student} 想请 ${coach} 担任象棋教练` : `Please confirm: ${student} wants ${coach} as their Xiangqi coach`,
      text: both(
        lang,
        [
          "Hello,",
          "",
          `${student} plays Xiangqi on Xiangqi School and gave this email as their parent's or guardian's. They have asked the player "${coach}" to be their ${d.family ? "coach, as their parent or guardian" : "coach"}.`,
          "",
          `If you confirm, ${coach} can see ${student}'s finished online games, the reviews of those games, and their ratings. Not their chat, not games in progress, not anything else. There are no messages between them on the site. Every game the coach opens is listed for ${student} and on the page below.`,
          "",
          "To confirm or decline, open:",
          link,
          "",
          "On that page you can also let your child link coaches without asking you each time, and end the link whenever you like. The link works for 14 days, then 90 days after you answer. If you don't know who this is, ignore this email: nothing happens without your confirmation.",
          "",
          SIGN.en,
        ].join("\n"),
        [
          "您好：",
          "",
          `${student} 在象棋学堂下象棋，并填写了此邮箱作为家长或监护人邮箱。${student} 请棋手"${coach}"担任${d.family ? "教练（作为家长或监护人）" : "教练"}。`,
          "",
          `如果您确认，${coach} 可以看到 ${student} 已结束的在线对局、这些对局的复盘以及等级分。看不到聊天、进行中的对局或任何其他内容。网站上双方之间没有私信。教练查看的每一盘对局都会列给 ${student}，也显示在下面的页面上。`,
          "",
          "请打开以下链接确认或拒绝：",
          link,
          "",
          "在该页面上，您还可以允许孩子以后关联教练时不再每次征求您的同意，并可随时解除关联。链接 14 天内有效，您回复后再保留 90 天。如果您不认识这位学生，请忽略此邮件：未经您确认，什么都不会发生。",
          "",
          SIGN.zh,
        ].join("\n"),
      ),
    };
  },
  "coach-request": (lang, _d, site) => {
    const link = `${site}/${lang}/coach/`;
    return {
      subject: lang === "zh" ? "有棋手请你担任教练" : "A player asked you to be their coach",
      text: both(
        lang,
        `Hello,\n\nA player on Xiangqi School asked you to be their coach. See the request, and accept or decline it, on your Coaching page:\n${link}\n\nIf you didn't expect this, you can simply decline.\n\n${SIGN.en}`,
        `您好：\n\n象棋学堂的一位棋手请您担任教练。请在您的教练页面查看并接受或拒绝：\n${link}\n\n如果您没有预料到此请求，拒绝即可。\n\n${SIGN.zh}`,
      ),
    };
  },
  "email-change-new": (lang, d, site) => {
    const link = `${site}/${lang}/email-change/?t=${String(d.token)}`;
    return {
      subject: lang === "zh" ? "确认你的新邮箱" : "Confirm your new email address",
      text: both(
        lang,
        `Hello,\n\nThe Xiangqi School account "${String(d.username)}" asked to use this address. To confirm it, open:\n${link}\n\nThe link works for 7 days. If you didn't ask for this, ignore this email.\n\n${SIGN.en}`,
        `您好：\n\n象棋学堂账号"${String(d.username)}"申请使用此邮箱。请打开以下链接确认：\n${link}\n\n链接 7 天内有效。如果不是您本人申请，请忽略此邮件。\n\n${SIGN.zh}`,
      ),
    };
  },
  "email-change-old": (lang, d, site) => {
    const link = `${site}/${lang}/email-change/?t=${String(d.token)}`;
    const due = new Date(String(d.due));
    const day = (l: Lang) => due.toLocaleDateString(l === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" });
    return {
      subject: d.reminder
        ? lang === "zh" ? "提醒：你的象棋学堂账号邮箱即将更改" : "Reminder: your Xiangqi School email is about to change"
        : lang === "zh" ? "你的象棋学堂账号邮箱将要更改" : "Your Xiangqi School email is about to change",
      text: both(
        lang,
        `Hello,\n\nSomeone signed in to your Xiangqi School account asked to change its email from this address to ${String(d.new)}. Unless you answer, the change happens on ${day("en")}.\n\nTo approve it now, or to deny it (if it wasn't you: this also signs out every device), open:\n${link}\n\n${SIGN.en}`,
        `您好：\n\n有人在已登录您象棋学堂账号的情况下，申请将账号邮箱从此邮箱改为 ${String(d.new)}。如果您不回应，更改将于 ${day("zh")} 生效。\n\n如需立即批准，或拒绝（如果不是您本人：拒绝还会让所有设备退出登录），请打开：\n${link}\n\n${SIGN.zh}`,
      ),
    };
  },
  "email-change-denied": (lang, d) => ({
    subject: lang === "zh" ? "已拒绝更改邮箱：请修改密码" : "Email change denied: please change your password",
    text: both(
      lang,
      `Hello,\n\nYou denied the change of your Xiangqi School account's email. We've signed out every device, and no email change can be made for ${String(d.days)} days. Someone may know your password: sign in and set a new one in Settings → Account, and consider turning on two-factor sign-in.\n\n${SIGN.en}`,
      `您好：\n\n您已拒绝更改象棋学堂账号的邮箱。我们已让所有设备退出登录，${String(d.days)} 天内无法再更改邮箱。可能有人知道您的密码：请登录后在“设置 → 账号”中设置新密码，并建议开启两步验证。\n\n${SIGN.zh}`,
    ),
  }),
  "email-changed": (lang, d, site) => {
    const link = `${site}/${lang}/email-change/?t=${String(d.token)}`;
    return {
      subject: lang === "zh" ? "你的象棋学堂账号邮箱已更改" : "Your Xiangqi School email was changed",
      text: both(
        lang,
        `Hello,\n\nYour Xiangqi School account's email is now ${String(d.new)}. If that wasn't you, open this link within 30 days: it freezes changes, signs out every device and asks a moderator to restore this address.\n${link}\n\n${SIGN.en}`,
        `您好：\n\n您的象棋学堂账号邮箱已改为 ${String(d.new)}。如果不是您本人操作，请在 30 天内打开以下链接：它会冻结更改、让所有设备退出登录，并请管理员恢复此邮箱。\n${link}\n\n${SIGN.zh}`,
      ),
    };
  },
  "email-change-done": (lang) => ({
    subject: lang === "zh" ? "邮箱已更改" : "Your email address was changed",
    text: both(
      lang,
      `Hello,\n\nThis is now the email address of your Xiangqi School account. Sign in with it from now on.\n\n${SIGN.en}`,
      `您好：\n\n此邮箱现在是您象棋学堂账号的邮箱。今后请用它登录。\n\n${SIGN.zh}`,
    ),
  }),
  "sign-in-code": (lang, d) => ({
    subject: lang === "zh" ? `象棋学堂登录验证码：${String(d.code)}` : `Your Xiangqi School sign-in code: ${String(d.code)}`,
    text: both(
      lang,
      `Your sign-in code is ${String(d.code)}. It works for 10 minutes.\n\nIf you didn't just sign in, someone may know your password: sign in and change it in Settings → Account.\n\n${SIGN.en}`,
      `你的登录验证码是 ${String(d.code)}，10 分钟内有效。\n\n如果你刚才没有登录，可能有人知道你的密码：请登录后在"设置 → 账号"中修改密码。\n\n${SIGN.zh}`,
    ),
  }),
  "child-consent": (lang, d, site) => {
    const link = `${site}/${lang}/children/confirm/?t=${String(d.token)}`;
    const nick = String(d.nickname);
    return {
      subject: lang === "zh" ? `请确认：为 ${nick} 建立孩子档案` : `Please confirm: a child profile for ${nick}`,
      text: both(
        lang,
        [
          "Hello,",
          "",
          `You asked to create a child profile for "${nick}" on Xiangqi School. Before anything is kept about your child, please confirm it's you and that you agree:`,
          link,
          "",
          "What we keep: the nickname, birth year and country you gave, and your child's lessons, puzzles, bot games, ratings and settings, so their progress is saved. Why: only to run the site for your child. Where: Supabase's servers in the United States. Who sees it: only you (and your child on your device). No online play, no public profile, no chat, no ads. You can see, download or delete everything at any time in Settings → Children, which also withdraws your consent. Unconfirmed profiles are deleted after 14 days; unused ones after 24 months. The full notice is on the children's section of our privacy policy.",
          d.korean ? "\nKorea: on the confirmation page, please also type 동의 (I agree) or your own statement of consent." : "",
          "",
          "If you didn't ask for this, ignore this email: the profile is deleted in 14 days.",
          "",
          SIGN.en,
        ].join("\n"),
        [
          "您好：",
          "",
          `您申请在象棋学堂为"${nick}"建立孩子档案。在保存任何有关您孩子的信息之前，请确认是您本人并同意：`,
          link,
          "",
          "我们保存的内容：您填写的昵称、出生年份和国家/地区，以及孩子的课程、题目、人机对局、等级分和设置，以便保存学习进度。用途：仅为孩子提供网站服务。存储地点：位于美国的 Supabase 服务器。谁能看到：只有您（以及在您设备上使用的孩子）。没有在线对弈、公开资料、聊天和广告。您可以随时在“设置 → 孩子”中查看、下载或删除全部内容，删除即撤回同意。未确认的档案 14 天后删除；不再使用的档案 24 个月后删除。完整说明见隐私政策中的儿童部分。",
          d.korean ? "\n韩国家庭：请在确认页面上输入“동의”（我同意）或您自己的同意声明。" : "",
          "",
          "如果不是您本人申请，请忽略此邮件：该档案将在 14 天后删除。",
          "",
          SIGN.zh,
        ].join("\n"),
      ),
    };
  },
  "child-consent-2": (lang, d, site) => ({
    subject: lang === "zh" ? `${String(d.nickname)} 的档案已建立：您的权利` : `${String(d.nickname)}'s profile is set up: your rights`,
    text: both(
      lang,
      `Hello,\n\nYesterday you confirmed a child profile for "${String(d.nickname)}". As a reminder: only you can see it; you can download or delete everything, and withdraw your consent, at any time in Settings → Children (${site}/${lang}/children/). Nothing is shared with anyone else, and there is no online play, chat or public profile. Questions: the contact in our privacy policy.\n\n${SIGN.en}`,
      `您好：\n\n您昨天确认了"${String(d.nickname)}"的孩子档案。提醒您：只有您能看到；您可以随时在“设置 → 孩子”（${site}/${lang}/children/）中下载或删除全部内容并撤回同意。我们不会与任何人共享，也没有在线对弈、聊天或公开资料。如有疑问，请通过隐私政策中的联系方式联系我们。\n\n${SIGN.zh}`,
    ),
  }),
  "child-unused": (lang, d, site) => ({
    subject: lang === "zh" ? `${String(d.nickname)} 的档案即将删除` : `${String(d.nickname)}'s profile will be deleted soon`,
    text: both(
      lang,
      `Hello,\n\n"${String(d.nickname)}"'s child profile hasn't been used for 23 months, so it will be deleted in a month. To keep it, open it once from Settings → Children (${site}/${lang}/children/).\n\n${SIGN.en}`,
      `您好：\n\n"${String(d.nickname)}"的孩子档案已 23 个月未使用，将在一个月后删除。如需保留，请在“设置 → 孩子”（${site}/${lang}/children/）中打开一次。\n\n${SIGN.zh}`,
    ),
  }),
  "child-account": (lang, d, site) => {
    const link = `${site}/${lang}/child-account/?t=${String(d.token)}`;
    return {
      subject: lang === "zh" ? "你的象棋学堂账号" : "Your own Xiangqi School account",
      text: both(
        lang,
        `Hello,\n\nYour parent asked to turn your Xiangqi School profile ("${String(d.nickname)}") into your own account, with this email. Your lessons, games and ratings stay. To take it over, open:\n${link}\n\nThen set a password with "Forgot password" on the sign-in page. The link works for 14 days.\n\n${SIGN.en}`,
        `你好：\n\n你的家长申请把你在象棋学堂的档案（"${String(d.nickname)}"）转为你自己的账号，使用此邮箱。你的课程、对局和等级分都会保留。请打开以下链接接管：\n${link}\n\n然后在登录页面用“忘记密码”设置密码。链接 14 天内有效。\n\n${SIGN.zh}`,
      ),
    };
  },
  test: (lang) => ({
    subject: lang === "zh" ? "象棋学堂测试邮件" : "Xiangqi School test email",
    text: both(lang, "This is a test of the site's mailer. Nothing to do.\n\nXiangqi School", "这是网站发信功能的测试邮件，无需处理。\n\n象棋学堂"),
  }),
};

export function render(template: string, lang: string, data: Data, site: string): Rendered {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`no template "${template}"`);
  return t(lang === "zh" ? "zh" : "en", data, site.replace(/\/$/, ""));
}
