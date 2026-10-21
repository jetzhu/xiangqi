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
