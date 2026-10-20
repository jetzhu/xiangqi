# Coaching, donations and paid plans — research and proposal

> This file is the master copy of this proposal. Update it here, in the same commit as any change it leads to.

Oct 20, 2026 · Jet Zhu · **Draft for discussion** — nothing here is built yet

Three questions, researched on 2026-10-20: what coach features to support (an under-16 player especially should be able to link a coach who can see their games), how to accept donations so the site can keep running, and whether anything should be paid for — in particular by coaches teaching groups with the site. Prices and rules change; each figure below has its source and the date it was checked, and anything that couldn't be verified says so.

The guiding principle, from the rest of the site: **learning, play, ratings, fair play and analysis stay free for everyone, with no ads.** Money may only pay for running costs and for tools coaches use for their teaching — never for an advantage in play.

## 1. Coaching

### What comparable sites do

| Site | Coach and teacher features | Safeguards for children |
| --- | --- | --- |
| **lichess** | **Classes** (free): teachers (2FA required) add existing players or create student accounts with generated names and no email, track their games and puzzles, and post news and homework on a class board ([lichess.org/class](https://lichess.org/class)). A coach directory of titled players with rates; lessons are arranged off the site ([lichess.org/coach](https://lichess.org/coach)). Studies shared publicly, unlisted or by invitation ([blog](https://lichess.org/blog/V0KrLSkAAMo3hsi4/study-chess-the-lichess-way)). A reported cap of 100 students per class (forum, unverified). | Student accounts have kid mode (restricted chat) on by default. Teachers reported that they can't message a kid-mode student one to one. |
| **chess.com** | **Classroom**: a shared board with optional voice and video; the coach controls who moves and can load a student's games ([news](https://www.chess.com/news/view/chesscom-releases-new-classroom-feature)). Coach listing requires identity, a federation rating and age 18+; lessons and payment are "solely between the user and the coach" ([support](https://support.chess.com/en/articles/8648287-how-do-i-find-or-become-a-chess-coach)). | — |
| **ChessKid** | Groups, assigned lessons and videos, report cards, class matches ([support](https://support.chesskid.com/en/articles/8864339-coach-school-what-are-the-special-features-available-to-schools-groups)). | "Adult accounts cannot talk to kids. Ever." — except a guardian, who links by creating the child's account or by the child entering their email, and can read the child's messages ([safety](https://www.chesskid.com/article/view/how-to-understand-chesskids-safety-features2), [guardianship](https://support.chesskid.com/en/articles/8863569-how-to-connect-to-my-kid-through-guardianship)). |
| **天天象棋 Tiantian Xiangqi** | Clubs (棋社) with their own tournaments, smart review, courses by contracted masters ([App Store](https://apps.apple.com/cn/app/id403941510)). A "private coaching" release note couldn't be verified; no master–student (师徒) feature found. | Rated 9+. |
| **xiangqi.com** | Lessons from a teaching team; a coach can challenge a student from a handicap position ([help](https://www.xiangqi.com/help/handicap-mode)). | — |

The pattern: adults reach children only through a link the platform controls (a guardian or a class teacher), linking never opens a private chat, and coaching marketplaces with money stay off-site.

### Rules for children, at the depth a hobby site needs

- **COPPA (US, under 13):** collecting personal information needs verifiable parental consent; the 2025 amendments add a written security programme, a written retention policy and naming third parties ([Federal Register](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)). A school can consent only for an educational, non-commercial purpose, and the site stays responsible ([analysis](https://perkinscoie.com/insights/update/ftcs-coppa-enforcement-action-provides-lessons-edtech-providers)).
- **GDPR Article 8:** the age of digital consent is 16 by default, 13–16 by country (13 in the UK); below it, parental consent with "reasonable efforts" to verify ([overview](https://childreninthedigitalworld.twobirds.com/home/eu)).
- **UK Age Appropriate Design Code:** best interests of the child, high-privacy defaults, data minimisation, child-friendly explanations ([summary](https://tiga.org/?p=9917)).
- Not researched: mainland China's rules on minors online (real-name and play-time rules), which may matter if the site targets players there.

A coach seeing an under-16 player's games is a new disclosure of a child's data to another adult, so it must be off by default, minimal, and under the child's (and, young enough, a parent's) control.

### Proposed features

**First coaching milestone**

1. **The player starts the link.** The player (or their parent) sends a request by the coach's username, or enters a one-time code from the coach; the coach accepts; **either side can end it at any time**. Adults never reach out to children first.
2. **A parent or guardian confirms for under-16s**: the player gives a guardian's email, and the link starts only when the guardian clicks a confirmation. (An emailed confirmation is a common "reasonable effort", not proof.) A parent coaching their own child does both steps themselves.
3. **What a coach sees:** the player's finished online games, their replays and Game Reviews, and their ratings. Not chat, not games in progress, not anything else. Lesson and puzzle progress could be added later, with the player's agreement.
4. **Coaches are adults:** 18 or over by their birth month, verified email, account at least some days old.
5. **No messaging.** Linking opens no private chat; coaches talk to students' families outside the site, as on lichess and chess.com.
6. **A log of coach visits**, visible to the player, their guardian and moderators.
7. **Moderation:** report a coach, moderators can end links and bar an account from coaching.
8. **A coach page** listing their students, each student's recent games, and links to the reviews.

**Later**

- **Homework:** assign lessons, puzzle sets or positions, marked done or not done (needs the progress opt-in).
- **Classes with a join code:** a coach shares a code; players (with guardians, for under-16s) ask to join.
- **Shared annotated positions and games** (studies), visible to the class.
- **Coach challenges from a set position or with a handicap** — cheap, and suits Xiangqi teaching.
- **A teaching board** (coach moves, students watch), over the existing realtime channel; mind the free plan's 200 connections.

**Not for us**

- A paid coach marketplace or payments between users (disputes, liability, adults soliciting children).
- A public coach directory with rates.
- Voice or video.
- Formal verification of coaches' titles or identity (impractical; the site just says "coach", never "vetted").
- Coaches creating accounts for children without email (lichess's model makes the site the manager of child accounts).

### How many students

| Who | Free | Why |
| --- | --- | --- |
| A parent or guardian coaching their own children | **Up to 3** (your suggestion was 2) | Families of three children are common; chess.com's family plan covers 6 accounts. Two would leave a third child out for no saving: a student costs about 100–200 KB of storage a year. |
| A volunteer or club coach | **Up to 15 students**, one class | Covers a typical club evening. Free class tools elsewhere are generous (lichess classes are free; Google Classroom allows 250 per class); Kahoot's free plan allows 10. |
| Schools, non-profit clubs, Xiangqi associations | **Free on request**, approved by hand each year | As lichess and the UK's Chess in Schools arrangement with ChessKid do. |
| A coach teaching more | Paid plan (section 3), once there's demand | Coaches earning from teaching get clear value from bigger classes and reports. |

Students cost almost nothing to keep; the real limit is **classes playing at the same time** (realtime connections), so caps are about separating family and volunteer use from commercial teaching, not about cost.

### Decisions (2026-10-20)

1. **Guardian confirmation:** required for players under 16 by default. A parent may lower the line to 13 for their own child, after which a player aged 13–15 can link a coach without a confirmation each time (the parent's choice is logged and can be changed back).
2. **Opponents under 16:** a coach sees "an opponent under 16" in place of that opponent's name.
3. **Family links:** up to **3** children free.
4. **Audience:** worldwide, mainly China and the USA — so donations and payments need both card/PayPal and Alipay/WeChat Pay.
5. **Under-16 students per coach:** 15; above that, a moderator reviews the coach first.

## 2. Donations

Players are worldwide, mainly in **China and the USA** (decided 2026-10-20). Which platforms can pay out depends on the country where the owner receives the money, which is still to be confirmed.

### Platforms (fees checked 2026-10-20)

| Platform | Fee | One-off / monthly | For a static site | Notes |
| --- | --- | --- | --- | --- |
| **GitHub Sponsors** | **0%** for personal accounts ([docs](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors)) | Both | A link, plus a Sponsor button on the repository (`.github/FUNDING.yml`) | Donors need a GitHub account; cards and PayPal; ages 13–17 need a guardian ([terms](https://docs.github.com/en/site-policy/github-terms/github-sponsors-additional-terms)). |
| **Ko-fi** | **0% on one-off donations**; 5% on memberships unless Ko-fi Gold (fee figures from third parties, [Ruzuku](https://www.ruzuku.com/learn/articles/ko-fi-pricing)) | Both | A button or link | No account needed to give; cards and PayPal. |
| **Stripe Payment Link** | Stripe's card fees (2.9% + $0.30, +1.5% international, +1% conversion) ([pricing](https://stripe.com/pricing)) | One-off with Alipay/WeChat Pay | A URL | **The only option found with Alipay and WeChat Pay** ([Alipay](https://docs.stripe.com/payments/alipay), [WeChat Pay](https://docs.stripe.com/payments/wechat-pay)), if the owner's country is supported. Stripe restricts donations "for a reward" ([restricted list](https://stripe.com/legal/restricted-businesses)). |
| Liberapay | 0% + processing | Monthly only | A link | Receivers can't be in China ([global](https://liberapay.com/about/global)). |
| Open Collective (Open Source Collective) | 10% + processing ([fees](https://docs.oscollective.org/how-it-works/fees)) | Both | A link | The best public ledger, but needs an open-source licence and a GitHub organisation ([criteria](https://docs.oscollective.org/getting-started/acceptance-criteria)); the repository has neither today. |
| Buy Me a Coffee | 5% + processing | Both | A link | — |
| Patreon | 10% + processing ([Patreon](https://support.patreon.com/hc/en-us/articles/36426991446797)) | Mostly monthly | A link | Built around perks; 18+ or parental permission. Poor fit. |
| 爱发电 afdian | about 6% (2022 report, unverified) | Both | A link | WeChat Pay and Alipay only; withdrawals appear to need a mainland identity and bank (unverified). |

### How others do it

**lichess** (a French non-profit): monthly "Patron" support whose only perk is cosmetic wings — "no features are reserved for Patrons" — and a public cost spreadsheet ([patron](https://lichess.org/patron)). **Wikipedia**: many small donations (about 18 million averaging $10 in 2024–25) and yearly public reports ([report](https://meta.wikimedia.org/wiki/Fundraising/2024-25_Report)). No funding model was found for other Xiangqi sites.

### Recommendation

- **Start with Ko-fi** (0% on one-off gifts, no account needed) **or GitHub Sponsors** (0%, a Sponsor button on the repository), plus **a Stripe Payment Link with Alipay and WeChat Pay** for players in China — each only if available in your country.
- **A "Support us / 支持我们" page**, linked from the footer, Help and the repository, saying: free with no ads, forever; run by one volunteer; gifts are personal and **not tax-deductible** (never say "charity"); what it costs now ($0 a month) and what money would pay for; that **donations never unlock anything in play**; "under 18? please ask a parent first"; refunds on request within 30 days; a link to the spending report.
- **A spending report** (`docs/costs.md`, updated each quarter, as lichess does): income after fees, each cost, the balance, and what a surplus is kept for.
- **Perks:** at most an optional, cosmetic supporter badge and an opt-in thanks list — never on children's accounts, never showing amounts.
- **Never:** pop-ups or prompts in games, lessons or puzzles; anything aimed at children; storing payment details on the site (the platforms hold donor data; the privacy policy names them).
- **What it would pay for:** today the site costs **$0 a month**. Outgrowing the free plan means Supabase Pro from **$25 a month** ([pricing](https://supabase.com/pricing)) and perhaps a domain (about $11 a year, third-party figure): **about $310–430 a year**.

**Tax (not legal advice):** gifts to an individual are generally taxable income; keep records and check your local rules.

## 3. Paid plans

### What others charge for

- **chess.com:** the free plan limits Game Review (1 a day), puzzles (3 a day) and lessons (1 a day) and shows ads; paid tiers lift those limits ([help](https://support.chess.com/en/articles/8562418-what-does-each-level-of-membership-get-me)); list prices around €50–125 a year (May 2026 deal page, unverified).
- **ChessKid:** free basic accounts; Gold (about $40–49 a child a year, unverified) unlocks the teaching content; coaches and schools get discounts or licences ([ChessKid](https://www.chesskid.com/learn/articles/how-to-buy-upgrade-and-manage-gold-memberships2)).
- **lichess:** everything free, including classes ([class](https://lichess.org/class)).
- **天天象棋:** a ¥24–30 a month privilege subscription; deeper AI analysis with paid "analysis cards" (older guide, [toutiao](https://www.toutiao.com/zixun/7546074533329979418/)).
- **xiangqi.com:** no paid tier found.

### What we could charge for

| Feature | Charge? | Why |
| --- | --- | --- |
| Game Review, engine analysis | **No** | It runs in the player's own browser and costs nothing; free analysis is what earns trust (lichess, xiangqi.com). |
| Lessons, puzzles, bots, ratings, matchmaking, fair play | **Never** | Learning basics and fairness; any link to payment would be, or look like, pay-to-win. |
| Ad-free | **No** | There are no ads. Promise "no ads, ever" instead. |
| "Priority" or "more reliable" service | **No** | Everyone shares one database; there's no faster lane to sell. Better reliability for everyone (Supabase Pro, backups) is what donations pay for. |
| Coach and club tools beyond the free caps: more students, several classes, homework, progress reports, exports, private club tournaments | **Yes — the one paid product** | Value for people who teach, often for pay, without taking anything from learners (ChessKid's model). |
| Saved analyses and studies beyond a generous free quota | Maybe, later | A small real storage cost. |
| Certificates, worksheets | Free for players; club-branded versions in the coach plan | Children are motivated by them. |
| A supporter badge | Optional thank-you for donors | Cosmetic, as lichess does. |

**Indicative coach plan**, once there's demand: about **$3–5 a month ($30–40 a year)** for up to 50 students with unlimited classes, homework, reports and exports; a **club** level around **$8–10 a month** for up to 200. This sits well under ChessKid's per-child price and near teacher tools at $10–12 a month.

### How payment would work

- **Selling is different from receiving gifts.** Selling digital services to people abroad brings sales taxes (VAT applies from the first sale to EU consumers for sellers outside the EU, [Fonoa](https://www.fonoa.com/resources/blog/the-eu-vat-reform-oss-ioss-and-moss)). A **merchant of record** — Paddle, Lemon Squeezy, or Stripe's Managed Payments (since April 2026, [changelog](https://docs.stripe.com/changelog/dahlia/2026-04-22/managed-payments.md)) — is legally the seller and handles those taxes and refunds, for about 5% + $0.50 a sale (figures partly unverified). It doesn't handle income tax: selling is trading, which may mean declaring business income or registering — check with a local accountant before launching.
- **Players in China:** Paddle supports Alipay subscriptions; WeChat Pay one-off only ([Paddle](https://developer.paddle.com/changelog/2024/recurring-alipay-subscriptions)); yearly one-off passes suit them best.
- **On the site:** checkout carries the account's id; the payment provider calls a Supabase server function, which checks the signature and records the plan (plan, seats, valid until) in a table only the server writes; the database enforces seat caps; the page only displays the plan. Cancellations and refunds set the end date; going over a cap after a downgrade makes the coach read-only, never deletes anything.
- **Children never see prices or buy:** only adult accounts see checkout.

### Recommendation: in stages

1. **Now:** donations only (section 2), with a public pledge: learning, play, ratings, fair play and analysis free forever, no ads.
2. **Coaching v1, free:** guardian links for up to 3 children and one class of up to 15, with the seat caps checked by the database from the start (set to the free defaults).
3. **When coaches need more** (for example, ten coaches at their cap, or hosting moves to the paid plan): a coach and club plan through a merchant of record, with yearly passes for Alipay and WeChat Pay.
4. **Always:** free access for schools and non-profit clubs on request.

**Avoid:** paywalling Game Review or analysis; anything touching ratings, pairing or fair play; selling "priority"; prices shown to children; selling without a merchant of record.

## 4. Younger children (researched 2026-10-20)

The question: could a parent lower the age line further, for example so a parent can coach their 7-year-old? Today **accounts start at 13** (higher in some countries: 14 Italy and Korea, 15 France and Japan, 16 Germany, Spain, the Netherlands and Poland, 18 Hong Kong and India), and younger visitors use the site as guests, with their progress only in their own browser. Letting a parent lower the coach line below 13 therefore means letting children under 13 have accounts, which is where the strictest rules apply. General information, not legal advice.

### What the rules require for under-13s

- **USA (COPPA, amended rule in force 2025-06-23, compliance by 2026-04-22):** asking for a birth month and admitting a child under 13 is "actual knowledge", so COPPA applies to that account even on a foreign site ([FTC FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)). Game records and an account id are personal information. **Verifiable parental consent** must come first, by a signed form, a card transaction, a call, an ID check, knowledge-based questions or a face match ([16 CFR 312.5](https://www.law.cornell.edu/cfr/text/16/312.5)); the cheap **"email plus"** method is allowed only if the child's data is never disclosed to anyone — and a coach seeing the games is arguably a disclosure. Also required: a direct notice to parents naming who gets the data, parents' rights to review and delete, a published retention policy and a written security programme ([Federal Register](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)). The FTC does fine small operators (for example $60,000 for LAI Systems, [FTC](https://www.ftc.gov/node/44784)).
- **Mainland China:** a child's personal information is "sensitive" under 14 and needs a guardian's consent and its own processing rules ([PIPL Art. 28 and 31](https://digichina.stanford.edu/work/translation-personal-information-protection-law-of-the-peoples-republic-of-china-effective-nov-1-2021/); [CAC 2019 provisions](https://www.cac.gov.cn/2019-08/23/c_1124913903.htm)), and PIPL reaches operators abroad who serve people in China. The 2024 Regulations on the Protection of Minors Online require minor mode and real-identity checks for online games ([State Council](https://www.gov.cn/zhengce/content/202310/content_6911288.htm)); a 2026 draft would extend minor mode to under-16s ([Xinhua](https://www.news.cn/politics/20260918/3e78d1511b7649eba6f2f6d20c9e1219/c.html), not yet in force). Online Xiangqi with ratings looks like a chess-and-card online game, which in China needs a licence a foreign hobby site can't get; the realistic risk is being blocked rather than pursued (judgement, not verified). China's real-name systems aren't available to a foreign operator.
- **Elsewhere:** EU GDPR, parental consent below 13–16 by country with "reasonable efforts" to verify ([GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj)); UK 13, plus the Children's Code for anyone under 18 ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/)); South Korea, a legal representative's confirmed consent below 14 ([PIPA Art. 22-2](https://prighter.com/resources/laws/korean-pipa/main/articles/article-22-2)); Singapore, a parent's consent below 13 (2024 guidelines, [CMS](https://cms.law/en/sgp/legal-updates/singapore-personal-data-regulator-issues-guidelines-for-processing-children-s-personal-data)); Japan, a guardian's consent expected for younger children; Hong Kong and Taiwan, no fixed age (unverified); Vietnam, both parent and child consent from age 7 (unverified).
- **Sign-in services:** GitHub requires 13+, and Google accounts follow the country minimum, so children under the minimum couldn't use those sign-ins anyway.

### How others do it

chess.com sends under-age children to ChessKid ([support](https://support.chess.com/en/articles/16208488-how-does-chess-com-help-keep-children-safe)); ChessKid and Khan Academy let a parent create the child's account from their own adult account, with no child email ([ChessKid](https://support.chesskid.com/en/articles/8871815-how-to-add-a-kid-to-my-adult-account), [Khan](https://support.khanacademy.org/hc/en-us/articles/202262974)); lichess requires 15 (or the local age), or a parent's authorisation, with kid mode ([terms](https://lichess.org/terms-of-service)); Tiantian Xiangqi uses Tencent's real-name and anti-addiction system (an hour a day and no play at night for 12 and under, [ithome](https://www.ithome.com/0/408/044.htm)).

### The risks of a parent-lowered line

- **Consent can be faked:** a child can type a parent's email and click the link. Email confirmation isn't valid consent for under-13s when a coach sees the games.
- **Safeguarding:** a "coach" who isn't the parent gets an ongoing view of a young child's activity, and contact can move off the site. We can't vet coaches.
- **Liability:** the site is run by an individual, with no company in between, and COPPA penalties are per violation.

### Options

| | Option | Legal risk | Effort |
| --- | --- | --- | --- |
| 1 | Parents may lower the coach-confirmation line **only within 13–15** (players who can already have accounts) | Low | Low |
| 2 | Under-13s stay guests; a parent follows their progress **on the child's own device** (nothing uploaded) | Low | Low–medium |
| 3 | **Child profiles managed under the parent's account** (ChessKid/Khan style): a nickname only, no email or birth date, no online play, visible to the parent alone; a stronger consent method, a notice to parents, review and delete, a retention policy, China's children's rules | Medium | High |
| 4 | Full under-13 accounts with online play | High | Very high |

**Recommendation:** option 1 now, which is the decision already taken (guardian confirmation under 16, a parent may lower it to 13), plus option 2 for younger children. That covers a parent coaching their own 13–15 year old without new under-13 data. If families with 7–12 year olds ask for more, build option 3 limited to **the parent as the only coach**, and only after a lawyer has looked at it. Questions for a lawyer: whether a parent-chosen coach is a COPPA "disclosure"; whether a parent creating a child profile counts as consent under COPPA, PIPL and Korea's PIPA; whether a free Xiangqi site is an "online game" in China and an offshore operator's exposure under PIPL; whether the 18 line for Hong Kong is needed.

### Plan for children under 13: profiles under a parent's account (agreed 2026-10-20)

A parent creating the child's account from their own signed-in account is the pattern ChessKid and Khan Academy use. The parent being signed in doesn't by itself count as the consent the rules ask for, and the rules still apply to the child's data once it exists; this plan keeps that data small and visible only to the parent, so the lighter consent methods stay available. A legal review is under way (section 4, "Legal questions" below); build only after it.

1. **The parent creates the profile** in Settings: a nickname, the birth year (only to know when the child turns 13), the country. No child email, no password of their own, no Google/GitHub/Microsoft sign-in (all require 13+). The child uses the site on a device where the parent is signed in, switching to their profile, optionally with a PIN.
2. **Consent:** a clear notice to the parent first (what's kept, why, for how long, where, who sees it, the parent's rights), then "email plus" confirmation: the parent confirms by email, followed by a second confirmation email later.
3. **What the child can do:** lessons, puzzles, bots and analysis, with progress saved to the profile. **No online play, no public profile, no chat.**
4. **Coaching: the parent is the coach** — no further consent, since the parent isn't a third party. A second coach, or online play later, requires a stronger verifiable consent first (for example a small refundable card charge).
5. **The parent's controls:** see everything, export, delete the profile at once, withdraw consent.
6. **At 13:** the parent can turn the profile into the child's own account, keeping its history.
7. **Policy pages:** a children's section in the privacy policy (what, why, how long, where — US servers — the parent's rights, the person responsible), and a Chinese version of the children's rules for mainland families.

This makes "a parent coaching their own child" possible at any age, while children under 13 still can't be reached by other adults or play strangers.

### Legal questions (research memo, 2026-10-20)

A research memo written from an experienced privacy lawyer's point of view, from public sources — **not legal advice**. It checked the US rule text (16 CFR 312.2, 312.4, 312.5, 312.8, 312.10 on [LII](https://www.law.cornell.edu/cfr/text/16/312.5)), Korea's Enforcement Decree Art. 17-2, and the September 2026 Chinese draft ([Junhe](https://junhe.com/legal-updates/3159)); other points are from secondary sources and marked for a lawyer.

**Bottom line:** the plan fits US law well; most of the gap is paperwork. Korea is workable with a small change to the consent email. Mainland China is the hard one: the law reaches a foreign site serving mainland users, and one requirement (a representative in China) a foreign individual can't realistically meet — the realistic outcome is blocking, not fines. EU and UK email consent is acceptable for data this low-risk. Hong Kong doesn't require 18 by law.

| Question | Conclusion | Confidence |
| --- | --- | --- |
| **US:** is "email plus" enough when only the parent sees the profile? | Yes. Email plus is still a listed method when nothing is disclosed (312.5(b)(2)); a parent viewing their own child's data is the parent's right of review, not a disclosure (312.2); Supabase and Gmail are service providers for internal operations, not third parties. A second coach **would** be a disclosure: then a stronger consent method and separate consent to disclosure (312.5(a)(2)). | High |
| **US:** what else does the 2025 rule require? | A written security programme with a named coordinator and a yearly review (312.8), with written assurances from processors; a written, published retention policy with deletion timeframes (312.10); a direct notice to the parent with the listed items, including the right to revoke (312.4(c)); a children's section in the privacy policy with **the operator's name, address, phone and email** (312.4(d)). | High |
| **US:** does COPPA even apply to a free hobby site? | Arguably not ("operated for commercial purposes"), but the FTC reads that broadly and donations or paid plans weaken the argument: comply as if it applies. Realistic enforcement risk for a small, ad-free, non-disclosing site that does the above: very low. | Low–medium |
| **Korea** (under 14) | The decree's email method is the parent **replying by email** with their consent; a one-click link is most defensibly "an equivalent method". Ask Korean parents to reply "동의" (or record an explicit statement of consent), and keep the record. No local representative needed at this scale. | Medium |
| **Mainland China** | The law applies (PIPL Art. 3(2)). It requires a representative in China (Art. 53, no small-site exemption), standalone children's rules with a named responsible person (2019 CAC Art. 8), separate consent for sensitive data, and a written impact assessment kept 3 years (Arts. 29, 55–56). Lessons, puzzles and bots might be seen as a single-player online game; **online play would clearly be one**, bringing real-name checks and time limits a foreign individual can't meet. The September 2026 draft (minor mode for under-16s) isn't in force; watch for the final text. | Medium on the law, low on the game question |
| **EU/UK** | Email consent is "reasonable efforts" for low-risk data (EDPB consent guidelines). The UK Children's Code needs a data protection impact assessment, private defaults and a child-friendly explanation that the parent can see their progress. | High |
| **Hong Kong** | No minimum age in law: the 18 copied from chess.com is a policy choice; 13, as elsewhere, is defensible. | Medium–high |
| **Vietnam** | The 2025 data law (in force 2026-01-01) generally needs a parent's consent, and for some data the child's own consent from age 7 too. | Medium |

**Changes to the plan before building:**

1. A short written **security programme** (coordinator: the owner; yearly risk review; safeguards such as row-level security, two-factor sign-in on admin accounts, encrypted backups; a yearly test).
2. A published **retention policy**: child profiles deleted after a set time without use; consent records kept a set number of years as proof; unconfirmed profiles deleted after 7–14 days.
3. File the **Supabase and Google terms** as the processors' written assurances.
4. A **notice-to-parent email** covering every item in 312.4(c)(1), including the right to revoke.
5. A **children's section in the privacy policy** with an operator contact block — **a postal address and phone number become public**, so decide on a PO box or virtual address and a virtual phone number (a lawyer should confirm these are acceptable).
6. The parent **re-enters their password** to create a profile and to confirm consent, so a child can't do it.
7. A child profile never appears publicly or on leaderboards.
8. A stronger consent method before any second coach or online play for children.
9. **Korea:** the Korean consent email asks for a reply or an explicit recorded statement of consent.
10. **China:** standalone Chinese children's rules naming the owner as the responsible person; a separate tick-box consent for children's (sensitive) data explaining why it's needed; a written impact assessment, updated yearly; no game-like elements in child profiles (no rankings, no time rewards); no online play or chat for under-18 mainland users. Either accept the gap on the representative in China, or **don't offer child profiles to mainland users** until a Chinese lawyer has advised.
11. **EU/UK:** one short impact assessment (it can double as China's); a child-friendly line in the profile saying the parent can see their progress; private defaults.
12. **Vietnam:** a simple "do you agree?" screen for the child aged 7 or over, alongside the parent's consent.
13. Optionally, lower Hong Kong's minimum age from 18 to the general 13.

**For a licensed lawyer to confirm:** US — whether a free individual site is "commercial", and whether donations change that; a PO box and virtual phone for the notice; the Supabase and Google terms as written assurances; a link click as email plus. Korea — a one-click link as an "equivalent method". China — whether a foreign individual can appoint a representative; direct collection versus data export; whether bots, puzzles and saved progress make it an online game; the final September 2026 rules; whether the yearly compliance audit applies at this scale. EU/UK — the exemption from appointing an EU representative; combining the two impact assessments. Vietnam — the exact articles and whether a foreign site is in scope. Hong Kong — that nothing requires 18.

### A site hosted in mainland China, run with an agent there (research memo, 2026-10-20)

Asked after the memo above: the owner plans a separate instance of the site hosted in mainland China and operated by an agent there, which would provide the local presence PIPL asks for. A research memo from a PRC internet and data lawyer's point of view, from public sources — **not legal advice**; many points rest on provincial practice and secondary reports, marked for a licensed PRC lawyer.

**What hosting in China brings**

| Area | What applies | Confidence |
| --- | --- | --- |
| **Website filing** | A mainland-hosted site must be filed (ICP 备案) through the hosting provider before going live, and with the public security bureau (公安联网备案) within 30 days. An **individual can file a non-commercial site**, but provincial practice limits personal filings to display-type sites: no forums or communities, no social features, **no games**; some provinces also object to registration and login. Online play, public profiles and preset chat would very likely be refused on a personal filing. | Medium |
| **Who files** | The filer must really be the site's owner and legally responsible person, with face-verified real names; a nominee filing for someone abroad is a known compliance problem. Put the agent's operator role, data control and moderation duties in a written agreement that matches reality. Whether a foreign passport holder can file personally depends on the provider. | Medium |
| **Money** | A paid plan is a commercial service: a company and a commercial ICP licence. Donations are grey; collecting them on a website needs a WeChat Pay/Alipay merchant account, which needs a business licence (a company or 个体工商户). Only registered charities may fundraise publicly. | Medium–high |
| **Online play** | Online Xiangqi with matchmaking and ratings is very likely a chess-and-card online game, which needs NPPA publishing approval (版号) through a licensed publisher — **no exemption for free games**, foreign investment in online publishing is prohibited, and approvals are rationed. Then real-name checks through the national anti-addiction system and minors limited to 20:00–21:00 on Fridays, weekends and holidays. **Not feasible for a hobby project.** | Medium–high |
| **Bots, puzzles, lessons** | Lessons and the analysis board are an information service, not a game. Puzzles are close to exercises (lower risk). Bots are the grey area: playing against the computer may be read as a game. | Low–medium |
| **Accounts** | Real-name verification by mobile number (SMS, which itself needs a company sender), screening of usernames and avatars, logs kept at least 6 months, a reporting channel. Expect a company filing once there are accounts. | Medium–high |
| **Personal data** | Full PIPL duties as a domestic processor. **The children's line is under 14**, not 13: a 13-year-old's account needs a guardian's consent too. Children's rules, a named responsible person, separate consent, an impact assessment, a yearly audit. | High |
| **Data crossing borders** | Not critical infrastructure, so no blanket localisation duty — but **any child's data sent to the US needs a standard contract** (sensitive data has no small-volume exemption), and the owner looking at the China database from abroad counts as a transfer. **Keep China accounts separate, with no sync, and no routine access from abroad.** | High that this is simpler |

**Child profiles in the China instance:** lessons, puzzles and analysis can be offered without being an online game; leave bots out (or limit them) to stay clear of the game rules. The parent's account verified by mobile number; a separate consent screen for the child's data; nickname and birth year only (drop the country); no social features or public profile, which the plan already has; children's rules, a responsible person, an impact assessment and a yearly audit.

**Recommended phases for China**

1. **A learning site** — lessons, puzzles, the analysis board (bots as a stated risk); **no accounts** (progress stays in the browser), no money, nothing identifying sent to the server; filed personally by the agent as the real owner, plus the public security filing. A few hundred yuan a year; 1–4 weeks.
2. **Accounts** (and child profiles) — mobile-number real names, name screening, a privacy policy and children's rules, an impact assessment, log retention; most likely a company filing (a company owned by the agent, or a 个体工商户): roughly ¥5,000–20,000 a year (estimate).
3. **Online play** — only through a licensed publisher with an approval, a domestic company and the anti-addiction system: six figures in yuan and 6–24 months with no assurance. **Not for this project**; mainland players who want online play can use licensed Xiangqi platforms, or the worldwide site where it's reachable.

**The agent carries the legal responsibility:** penalties under the Cybersecurity Law (raised from 2026) and PIPL (including personal fines for responsible people), cancellation of the filing, and in extreme cases criminal liability for refusing network-security duties or unlicensed game publishing. This should be clear to them, in writing.

**For a licensed PRC lawyer:** the chosen province's stance on personal filings with registration or bots; whether bots and puzzles need a 版号; a domestic company versus the foreign-investment pilot; the exact article numbers and the final September 2026 minors rules; an acceptable guardian-consent method and audit format; tax on donations; whether a paid coach plan falls under the off-campus training rules; and whether the worldwide (US) site's mainland users still need a PIPL representative.

## 5. Receiving money: the US, mainland China, or Hong Kong (researched 2026-10-20)

Players are mainly in Asia (mainland China first), with fewer in the USA and elsewhere. What decides the options is **where the owner receives the money**. General information, not tax or legal advice.

### As a US resident

- **Stripe** opens for an individual as a sole proprietor with a Social Security number, no company needed ([Stripe](https://support.stripe.com/questions/signing-up-for-stripe-as-a-sole-proprietor-without-employer-id-number)); tips and donations on your own site are allowed (it restricts charity fundraising and bans donations to individuals only in Japan, [restricted list](https://stripe.com/legal/restricted-businesses)).
- **Chinese donors can pay a US Stripe account with Alipay and WeChat Pay** (one-off; Payment Links supported), priced in yuan and settled in US dollars, for 2.9% + 30¢ plus 1% for conversion ([Alipay](https://docs.stripe.com/payments/alipay), [WeChat Pay](https://docs.stripe.com/payments/wechat-pay), [fees](https://stripe.com/pricing/local-payment-methods)). No chargebacks; refunds within 90 and 180 days.
- **GitHub Sponsors** pays out in the US (0% fee), and **Ko-fi** pays into your own Stripe or PayPal.
- **Paddle bans donations** (it needs a real product, [AUP](https://paddle.com/support/aup)), so it's only for a later subscription; there it handles sales tax and VAT and supports Alipay subscriptions in yuan.
- **Tax:** the 1099-K reporting line is back to over $20,000 and over 200 payments (2025 law), but every dollar is still income; donations from a site's own users are generally income rather than gifts (confirm with an accountant); selling means Schedule C. US state sales tax on a $3–5 subscription is very unlikely outside the owner's home state; a merchant of record removes the question.

### As a mainland China resident

- **Personal WeChat/Alipay payment codes** on a website are risky: since 2022 the central bank requires business-like collection to use merchant codes ([36kr](https://www.36kr.com/p/1501333111470979)); a full merchant account needs a business licence (个体工商户 or a company).
- **爱发电 (afdian)** is a compliant route for mainland donors: creators keep 94% ([FAQ](https://guide.afdian.com/faq/faq-for-creators)); its real-name withdrawal rules weren't confirmed.
- **No Stripe, GitHub Sponsors or Ko-fi payouts** to the mainland. **PayPal** works for international donors: withdraw in US dollars to a mainland bank for $35 each time ([PayPal](https://www.paypal.com/c2/webapps/mpp/paypal-fees)). Whether Paddle pays mainland banks is undocumented.
- Personal foreign-exchange conversion is capped at US$50,000 a year (not a concern at this scale); income is taxed as 劳务报酬 (3–45%) and foreign income must be declared in the annual return. Charging users could look like a commercial internet service, which nominally needs a commercial licence; enforcement against foreign-hosted hobby sites is unclear.

### Through Hong Kong

**Stripe Hong Kong** supports Alipay, WeChat Pay and cards, reportedly with cheaper wallet fees (about 2.2% + HK$2, unconfirmed), and GitHub Sponsors pays out there — but it needs a Hong Kong identity card and a business registration certificate for a sole proprietor, or a Hong Kong company (yearly costs of a few thousand US dollars, unverified). Hong Kong taxes only Hong Kong-sourced profits.

### Both yuan and dollars

Yes. **Stripe's Adaptive Pricing** is on for Payment Links: it shows prices in the visitor's currency (including mainland China, Hong Kong, Taiwan, Singapore and Malaysia) by location, which also unlocks Alipay and WeChat Pay; the customer pays a 2–4% conversion fee and the account settles in its own currency ([Stripe](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing.md?payment-ui=stripe-hosted)). So **one Stripe account shows ¥ to players in China and $ to others**. For donations, the Support page can offer amounts in both (¥10 / ¥30 / ¥68 and $2 / $5 / $10). For subscriptions, Alipay and WeChat Pay recurring payments are still limited on Stripe, so yearly one-off passes are the simple answer; Paddle supports Alipay renewals.

### Recommendation by where the owner receives money

| | Donations now | A coach plan later | Avoid |
| --- | --- | --- | --- |
| **US resident** (simplest) | A Stripe Payment Link (pay what you want) with Alipay, WeChat Pay and cards, showing ¥ or $ automatically; plus GitHub Sponsors or Ko-fi | Paddle (handles taxes, Alipay renewals), or Stripe with yearly passes for wallet payers | Paddle for donations |
| **Mainland China resident** | 爱发电 for mainland donors; PayPal for international donors (withdraw in batches) | A 个体工商户 licence with a WeChat Pay/Alipay merchant account, or Paddle if it pays mainland banks | Personal payment codes on the site; Stripe, GitHub Sponsors and Ko-fi (no payouts) |
| **Hong Kong** (identity card or company) | Stripe Hong Kong with wallets and cards; GitHub Sponsors | Stripe Hong Kong, or Paddle | A Hong Kong company just for donations |

Questions for an accountant: whether donations are income or gifts and how to report them; sales tax for a subscription (or simply use Paddle); for a mainland resident, declaring foreign income and whether charging triggers business registration or a commercial internet licence; for Hong Kong, the business registration and where profits are sourced.

## Not verified

Sections 4 and 5 mark their own unverified points. From sections 1–3: chess.com's and ChessKid's current prices; Ko-fi Gold's price; Buy Me a Coffee's countries and age rule; afdian's fees and rules for recipients outside China; whether mainland China residents can receive GitHub Sponsors payouts or donors there can use PayPal; Tiantian Xiangqi's VIP contents and private-coaching feature; lichess's class cap and coach-listing criteria; Stripe Managed Payments' fee; the domain price.
