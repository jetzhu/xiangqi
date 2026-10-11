# Chess.com Feature Study — Requirements for a Xiangqi Teaching & Playing Site

> This file is the master copy of this design document. It was first drafted in Claude Docs and moved here on 2026-10-10; update it here, in the same commit as the change it describes.

Oct 4, 2026 · Jet Zhu

## Purpose and method

This doc turns a hands-on study of [chess.com](https://www.chess.com) into requirements for a Xiangqi (Chinese chess) site that teaches and plays the game equally well.

- **Method:** walked the site in Chrome as a guest (not logged in) on 2026-10-04, page by page, noting what a guest can do and where the site asks for sign-up.
- **Scope:** guest-visible features only. Logged-in features (ratings history, saved games, full game review, membership perks) are listed as open questions for a second pass.
- **Positioning observed:** the home page sells four doors in this order — play bots, take lessons, solve puzzles, watch top players — under one "Get Started" sign-up button.

## Site map (guest view)

The site is one left sidebar with seven hubs; every hub page is a menu of tools sitting beside a live board, so the board is always on screen.

| Hub | Items a guest sees | Notes |
| --- | --- | --- |
| [Play](https://www.chess.com/play) | Play Online, Play Bots, Play Coach, Play a Friend, Tournaments (Arena), Chess Variants, Game History, Leaderboard | Board on the left, menu panel on the right |
| [Puzzles](https://www.chess.com/puzzles) | Solve Puzzles (500K+ problems), Puzzle Rush, Puzzle Battle, Daily Puzzle | Intro modal explains benefits |
| [Learn](https://www.chess.com/learn) | Lesson path: Learn To Play, Beginner, Intermediate, Advanced | "Sign Up to Save Your Progress" banner |
| [Train](https://www.chess.com/train) | Courses, Analysis, Insights, Classroom, Endgames, Practice, Aimchess Training | Insights and Aimchess need game history |
| [Watch](https://www.chess.com/watch) | Events, ChessTV schedule, Streamers, Leaderboards | Live viewer counts per stream |
| [Community](https://www.chess.com/community) | Friends, Clubs, Members, Coaches, Top Players, Chess Rankings, Leaderboards, Chess Today, News, Articles, Blogs, Forums | Mostly read-only for guests |
| [Other](https://www.chess.com/other) | Collections, Games Database, Chess Terms, Rules, Explore, Vote Chess, Solo Chess, Computer Championship, ChessKid, Tools, Vision, Shop, Merch, Gift | Long tail of tools and commerce |

Below the hubs sit Search, Sign Up, Log In, Help & Support and a language picker. A "Remove Ads" button is pinned bottom-right on every page.

## Play

Play vs bots is the guest's best entry: no sign-up, instant start, and a bot with personality who talks during the game. Human play and Coach push the guest toward an account.

**Online play (vs humans)** — [play/online](https://www.chess.com/play/online)

- Time-control picker with three families and three presets each: Bullet (1 min, 1+1, 2+1), Blitz (3 min, 3+2, 5 min), Rapid (10 min default, 10+5, 15+10); a Rated toggle; a Standard/variant selector.
- Custom Challenge: pick opponent by username, game type, time, rated/unrated, color ("I play as"), then Send Challenge or copy a Challenge Link.
- Live social proof on the panel: 219,206 playing, 23.5M games today.
- Guest gate: Start Game opens a skill-level survey (don't know how to play / know rules / know tactics / tournament player) with big Sign Up and Log In buttons and a small "Play as a Guest" link. Not tested: it would pair me with a real player I'd then abandon.

**Play Bots** — [play/computer](https://www.chess.com/play/computer)

- About 230 bots in 14 groups: New to Chess, Beginner, Intermediate, Advanced, Master, Adaptive, themed (Cryptids, Athletes, Musicians, Creators, Top Players, Personalities), Visualization, Engine. Each bot shows a rating (e.g. Martinfoot 250).
- Bots have their own board and piece skin and chat lines ("Welcome to my forest!").
- Options: No Timer or 12 time controls up to 60 min; assist toggles for Bot Chat, Evaluation Bar, Threat Arrows, Suggestion Arrows, Move Feedback, Engine; three preset mode icons.
- In game: opening name updates live ("King's Pawn Opening" → "Sicilian Defense"), move list, Resign (with confirm), Takeback, Hint (highlights the piece to move), Download, Settings.
- After the game: result, counts of Book / Great / Best moves, "Create Account to View Analysis", New Bot, Rematch, and an interstitial ad.

**Play Coach** — a guided game vs a coach character (Coach David) at 11 levels from New to Chess (100) to Maximum (3200), promising hints and takebacks. Sign-up wall for guests.

**Play a Friend, Tournaments (Arena), Variants** — friend games use the challenge link above. The Variants page rendered blank for a guest; the news feed shows variants such as Seirawan chess are a live product.

## Puzzles

Guests can solve rated puzzles right away; the competitive modes (Rush, Battle) are visible but gated behind sign-up.

| Mode | How it works | Guest access |
| --- | --- | --- |
| [Solve Puzzles](https://www.chess.com/puzzles/rated) | 500K+ puzzles. Rating goes up as you solve; puzzles get harder as you improve; faster solves earn a time bonus | Yes |
| [Puzzle Rush](https://www.chess.com/puzzles/rush) | Solve as many as you can: 3 min, 5 min, or Survival; starts easy and ramps up; three misses ends the run. Shows Best Today, Top Score, Leaderboard | Sign Up to Play |
| [Puzzle Battle](https://www.chess.com/puzzles/battle) | Head-to-head Rush vs a random opponent; win streaks multiply season points; has a rating, Watch and Leaderboard tabs | Sign Up to Play |
| Daily Puzzle | One shared puzzle per day | Page did not render for a guest |

**Solving UX observed**

- The first puzzles are mate-in-one onboarding, narrated in a speech bubble ("you can win in just one move!").
- A side-to-move checkbox ("White to move") ticks when solved; a green check lands on the moved piece; "Yes, indeed! You got it!".
- After solving: Retry, Analyze (magnifier), Next; plus comment, download and share icons; back/forward arrows through history.
- Hint button is always available; sound toggle at the top.

## Learn and Train

Teaching is layered: a free gamified path for absolute beginners, a free lesson library by masters, then paid video courses — each layer feeds practice back on the board.

**1. Learn path** — [learn](https://www.chess.com/learn)

- A game-style map of nodes in four sections: Learn To Play (12 lessons), Beginner, Intermediate, Advanced. A "Next Lesson" button always shows the next step.
- Side menu links out to Play Coach, Learn an Opening, and the Lesson Library.
- Guest can take lessons; progress is not saved ("Sign Up to Save Your Progress").

**2. Interactive lesson format** (observed in [The King](https://www.chess.com/lessons/learn-to-play/the-king))

1. Coach avatar introduces the piece in a speech bubble.
2. Board shows green arrows for every legal move of the piece.
3. Challenges ("Challenge 1/3"): drag the piece to capture a star; a progress bar fills; the coach reacts ("Nice! Now capture the next star.").
4. Arrows trace the path just taken; sound on by default.

**3. Lesson Library** — [lessons](https://www.chess.com/lessons)

- Tabs: Openings, Strategy, Tactics, Endgames, Master Games. Filters: Level, Theme, Instructor; sort by release.
- Each lesson series: title, one-line pitch, instructor with title badge (GM, IM, NM), lesson count, level (Beginner to Mastery). Examples: Magnus Carlsen's Stonewall, Hou Yifan: My Career So Far.
- Model per lesson: watch a video, test with Challenges, level up to Mastery. A "Learning Rank" widget (Pawn, 0/10) tracks progress.

**4. Courses (paid)** — [courses](https://www.chess.com/courses/all)

- 1,398 courses; cards show author, sale price vs list price (e.g. $24.49 down from $34.99), price with/without video, category, rating band (1200 to 2200), star rating and review count.
- Filters: Popular, Recommended, On Sale, Best Sellers, Free With Diamond, Free; skill level; game aspect; price range; color (for White / for Black); search by board position.
- Upsell: "Get 300+ Courses included free with Diamond".

**5. Openings** — [openings](https://www.chess.com/openings)

- Opening Principles, key-opening lessons, catalog grouped by first move (1.e4, 1.d4, other) with about 35 named openings.
- Explorer shows win/draw/loss % per first move (1.e4: 39% / 28% / 33%) linked to the Games Database.

**6. Endgames and Practice (vs computer)**

- [Endgames](https://www.chess.com/endgames): themes (Checkmates, Pawn, Minor Piece, Rook, Queen, Imbalances), Challenge Mode for a personal record, leaderboard. Engine plays at Maximum (3200).
- [Practice](https://www.chess.com/practice): drills from Master Games, Openings, Drills, or a Custom Position you set up.

**7. Other Train items** — Analysis, Insights (stats from your game history), Classroom (shared board for teacher and students), Aimchess (personalized training from past games). These need an account and are in the second pass.

## Analysis and game review

Guests get a full engine analysis board in the browser; the automated Game Review report and saving need an account.

**Analysis board** — [analysis](https://www.chess.com/analysis)

- Load box takes a PGN, FEN or study link. Start options: Set Up Position, New Analysis, Game Collections, Game Search (master games, players, your games), Explore, Saved Analysis, Classroom.
- Engine runs in the browser: Stockfish 19 Lite at depth 20, top three lines with scores (+0.33, +0.21, +0.18), on/off toggle and settings.
- Vertical evaluation bar beside the board (0.3 at the start).
- Three tabs: Analysis (lines and move tree), Games (add games, share, list, delete, edit, download), Explore (opening move stats from All Chess.com Games, Recommended Courses and Notable Games for the current position).
- Bottom bar: first / back / forward / last move, New, Save, Review, more menu. Save and Review were disabled for the guest.

**Game Review (pitched in the intro modal, needs an account)**

- Report with accuracy score, brilliant moves and blunders.
- Best lines and variations at each mistake.
- "Retry your mistakes and find the better move" — turns your own errors into puzzles.
- The post-bot-game screen already counts moves by class (Book, Great, Best) and links to this review.

## Watch and community

Content and community keep players returning between games; guests can read and watch almost everything but cannot post, join or chat.

| Area | What it offers | Seen as guest |
| --- | --- | --- |
| [Watch](https://www.chess.com/watch) | Events (Titled Tuesday, Collegiate League, Club Showdown, Freestyle Friday) with date ranges; ChessTV hourly schedule; live streamer list with viewer counts | Yes |
| [Events](https://www.chess.com/events) | Event pages with banner art, move-by-move broadcasts, real-time analysis, search | Yes |
| Leaderboards | Blitz, Bullet, Daily, Puzzle Rush (5 min), Puzzle Battle; title badges (GM, IM, FM, CM) | Yes |
| News, Articles, Blogs | Daily news by staff writers; feature articles; member blogs | Read only |
| Forums | Community Q&A | Read only |
| [Clubs](https://www.chess.com/clubs) | Clubs by country, school or creator (largest about 300K members); club tournaments, team matches, Vote Chess; local clubs by location; federations, leagues, daily and live matches | Browse only |
| [Coaches](https://www.chess.com/coaches) | Directory of human coaches: title, name, city, FIDE or national rating, bio with rates (e.g. $35 per 60-min lesson); filter by country; Challenge or Watch buttons; "Get Listed" application for coaches | Browse only |
| Members, Friends, Top Players, Rankings | Player search, friend lists, profiles of top players, official ratings lists | Partly |

Cross-site promotion: a sticky "Ready to Play Chess?" bar with a QR code to download the mobile app appears at the bottom of content pages.

## Accounts, membership and monetization

The model is freemium: playing is free and unlimited, while teaching features (review, explanations, stats, courses) are the paid hook. Revenue also comes from ads, paid courses and a shop.

**What a guest hits a wall on**

| Feature | Guest experience |
| --- | --- |
| Online play vs humans | Skill survey + Sign Up modal; small "Play as a Guest" link |
| Play Coach, Puzzle Rush, Puzzle Battle | "Sign Up to Play" |
| Lesson progress | Not saved; "Sign Up to Save Your Progress" |
| Post-game analysis | "Create Account to View Analysis" |
| Analysis Save / Review | Buttons disabled |
| Clubs, forums, friends, chat | Browse only |

**Membership tiers** — [membership](https://www.chess.com/membership), prices when billed yearly (monthly costs about 41% more), each with a 7-day $0 trial and a reminder on day 5

| Feature | Gold $4.17/mo | Platinum $6.67/mo | Diamond $10/mo | Friends & Family $16.67/mo |
| --- | --- | --- | --- | --- |
| Unlimited Puzzles, Lessons, Bots, Play Coach | Yes | Yes | Yes | Yes |
| No Ads | Yes | Yes | Yes | Yes |
| Game Review (unlimited) | No | Yes | Yes | Yes |
| Move Explanations | No | No | Yes | Yes |
| Advanced Stats | No | No | Yes | Yes |
| Courses Perks (300+ courses free) | No | No | Yes | Yes |

Friends & Family covers 2–6 members. Diamond is marked "Most popular". The page claims premium users raise their rating "2.7X faster".

**Other revenue seen:** display ads (side banner and post-game interstitial, with a "Remove Ads" button everywhere), paid courses ($14–$50, video add-ons), Shop, Merch, Gift memberships.

## Cross-cutting patterns and non-functional requirements

The same few patterns repeat on every page, and copying them matters as much as any single feature.

**UX patterns to copy**

- **One board component everywhere.** Play, puzzles, lessons, analysis, endgames and practice all reuse one board with the same drag-to-move, highlights, arrows, coordinates and move list.
- **Board left, task panel right.** Each hub is a board plus a right-hand panel that changes by task.
- **Coach character as narrator.** Lessons, puzzles and bots talk through an avatar in a speech bubble; this makes the site feel like a tutor, not a tool.
- **Intro modal per feature.** First visit to Puzzles, Rush, Battle, Bots, Lessons or Analysis shows a three-bullet explainer with one OK button.
- **Instant feedback.** Green check on a solved move, progress bars, move-quality labels (Book, Great, Best, Brilliant, Blunder), live opening names.
- **Always-available help.** Hint and takeback in bot games and puzzles; assist toggles (eval bar, threat and suggestion arrows) let each learner choose how much help.
- **Soft sign-up gates.** Guests get a real first experience, then hit a modal at the moment of value (save progress, see analysis, compete).
- **Social proof.** Live counts of players and games, member counts, viewer counts, leaderboards.

**Non-functional requirements observed**

| Area | What chess.com does |
| --- | --- |
| Platforms | Responsive web plus iOS and Android apps, promoted by QR code |
| Languages | About 70 UI languages, including Simplified, Traditional and Hong Kong Chinese |
| Theme | Dark UI by default; bot-specific board and piece skins |
| Sign-in | Email, phone, Google, Apple, Facebook; "Remember me" |
| Engine | Stockfish runs in the browser (depth 20) for guests, so analysis costs no server time |
| Audio | Move and feedback sounds with a mute toggle |
| Settings | Board settings gear on every board (needs an account) |
| SEO | Each lesson, opening and puzzle mode has its own URL and descriptive title, e.g. "The King in Chess - Value & Movement - Interactive Guide" |
| Fair play | Rated vs unrated games, titled-player badges, ratings per time control (detailed policy not visible to guests) |

## Logged-in home dashboard

After login, [home](https://www.chess.com/home) becomes a personal dashboard. Its job is to give the member a next step in each area and a reason to come back daily. (Checked with a Diamond test account; personal details left out.)

**Top row: one-click "continue" cards**

- Play Online box with the member's three favourite time controls (10 min, 5 min, 3 days), Start Game, then Play Online, Tournaments, Play Coach, Play a Friend.
- Three board cards, each showing a live position: **Solve Puzzles** (current puzzle rating, a streak counter and a progress bar), **Next Lesson** (titled with the next lesson, e.g. "Strike in the Center"), **Play Bots** (last bot played).
- Recommended Match: one suggested opponent of similar skill for a rated 3-day game, with a Challenge button.

**Game History table** (last 10 games, then View All Games)

- Columns: game-type icon (bot, coach, human), both players with rating, flag and membership badge, result with a win/loss/draw icon, both players' accuracy (e.g. 85.4 vs 74.4), move count, date, favourite heart.
- Games without a completed review show a **Review** button instead of accuracy.

**Right column: retention mechanics**

- **Daily Puzzle** card: title ("Beware of the Gift Horse"), "Solved by 446,480 players", countdown to the next one.
- **Day streak** with a flame icon and a week of tick boxes (W T F S S); a pause marker shows a streak can be frozen for a day.
- **League** ("Silver League, you are in 23rd place") — a weekly competitive ladder.
- **Friends** list with Add Friends.
- **Stats**: totals for Games, Puzzles and Lessons; ratings for Rapid, Bullet and Puzzles, each expandable.

**Sidebar footer for members:** profile, friends, messages, notifications, settings.

## Game Review (logged in)

Game Review is chess.com's core teaching feature: it turns any finished game into a coached lesson in three layers — a summary report, a move-by-move walkthrough, and long-term skill tracking. Checked on a past 80-move bot game.

**1. Summary report** (shown while the engine runs, with a chess trivia line as the loading message)

- Coach's one-line verdict: "You did a good job fighting that game, even though it didn't go your way in the end."
- Evaluation graph for the whole game, with coloured dots on key moments; clicking a dot jumps to that move.
- Accuracy per player (62.5 vs 70.3).
- Count of each move label per player, with an icon each: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder.
- **Game Rating**: the rating each side "played like" in this game (800 vs 1150).
- Phase grades with an icon each for Opening, Tactics, Strategy, Endgame (e.g. good, dubious, blunder).
- Buttons: Start Review, New Game.

**2. Move-by-move walkthrough** (Start Review)

- The coach bubble labels each move and gives a plain-language reason with the eval, e.g. Book +0.25 "Starting strong with a fundamental, versatile first move"; Blunder −2.72 "You are losing material this way."
- Board shows the label icon on the moved piece and a red arrow for the opponent's threat.
- **Explain** plays the refutation line on the board as a side variation in the move list, step by step with back/forward, then "Got it!".
- **Best** shows the better move with its own explanation (+1.34 "You step your king away from the checking rook"), then Resume.
- Move list shows label icons inline; captured material shown under each player's name; Play/Pause autoplay; Highlights; Share; favourite heart.

**3. Skills** (from the review panel)

- Five tabs: Fundamentals, Openings, Tactics, Strategy, Endgames.
- Each skill is a concrete habit with a target count and a progress bar, e.g. Develops Pieces 0/10, Pawns in Center 0/10, Connects Rooks 0/5, Fianchettos 0/3, Recaptures 0/10, Blocks Attacks 0/10. Fundamentals such as Captures, Checks, Castles, Checkmates, Defends Pieces are marked "Mastered".
- Games feed the counts, so the member sees habits improve over many games, not just one.

**Game History:** the home dashboard lists recent games with both players' accuracy, so a reviewed game shows its score at a glance and an unreviewed one shows a Review button.

## Learning features (logged in)

For members, every learning tool remembers where you are and adapts to your level. The coach also moves from after-game review into the game itself.

**Learn path with saved progress**

- The path map resumes at the member's current unit ("Advanced Endgames", "Advanced Openings") and greets them ("You're quite the learner! Keep it up with your next lesson.").
- Each node is a lesson icon on a diamond grid; the next one is tagged "Next" with a one-line pitch ("Learn to strike in the center.").

**Learning Rank** (Lesson Library sidebar)

- A rank ladder named after the pieces: Pawn, Knight, Bishop, Rook, Queen, King. The test account was King with 168 lessons mastered.
- Each lesson is mastered through watch → Challenges → mastery, so the rank counts mastered lessons, not just ones opened.

**Play Coach (member view)**

- Three difficulty choices before the game: Casual ("an easier game so you can focus on learning"), Balanced, Challenging, plus Show All Levels. The coach's rating adapts to the member (Coach David at 559 for Casual).
- Live coaching on every move: the coach labels a dubious move with an icon on the board and explains it at once ("Careful. Your f-pawn is an important defender of your king."). Opening name updates live ("Barnes Opening").
- Big Hint button in the centre, plus Resign and Takeback; eval bar on by default.

**Puzzles (member view)**

- Puzzle points with levels: a points total, a progress bar to the next level badge (16 → 17), and a streak flame for consecutive solves. "Classic Mode" (rating only) is a setting.
- Coach states the goal up front ("You can play checkmate soon. Do you see how?"); a solve timer runs; the board flips to the side to move.

**Insights** (being replaced by "Advanced Stats" at the end of 2026)

- Analysis runs as a background job ("analyzing 51 of your games … 3 players ahead of you in the queue … we will notify you").
- Filters: date range, game type; comparisons with Similar Players and Past Performance.

| Section | Question it answers | Metrics |
| --- | --- | --- |
| Games | How accurately are you playing? | Win/draw/loss, average accuracy when winning/drawing/losing, accuracy by move number, results by opponent rating, how games end, game shapes, game phases |
| Openings | How well do you play your openings? | 10 most-played openings as White and Black with results; book moves before you leave book; mastery |
| Tactics | How often do you find the winning moves? | Found vs missed forks, pins and mates (mate in 1 to 5+) per piece; pieces you left hanging; free pieces you took or missed |
| Moves | Strengths and areas to improve | Move-quality mix (Brilliant to Blunder, Missed Win) and trend over time; accuracy per piece; castling timing and results |
| Calendar | When do you play your best? | Accuracy and results by time of day and day of week |
| Geography | How do you compare worldwide? | World map or list |

Featured Insights shows the same dashboards for famous players (Hikaru, GothamChess, and others) as examples.

## Settings and personalization (logged in)

Settings have 10 tabs: Board & Pieces, Gameplay, Profile, Interface, Social, Coach, Notifications, Account, Membership, Accessibility. Most of them let each learner turn coaching help up or down. I only read the settings pages and saved nothing.

| Tab | Notable options |
| --- | --- |
| Board & Pieces | Board, piece and background themes plus presets with live preview; coordinates inside/outside; highlight last move; move method (drag, click, or both); win celebration (confetti); piece animation speed and style; 15 sound themes |
| Gameplay – general | Auto-queen, confirm resign/draw, show legal moves, focus mode, White always on bottom, castling method |
| Gameplay – live | Premoves, low-time warning, confirm move, multiple games at once (Premium) |
| Gameplay – daily | Confirm move, auto-claim win on time, vacation mode (30 days a year), days per move 1–14, what to show after moving |
| Gameplay – challenges | Who can challenge you (everyone / friends / nobody), rating range for incoming and open challenges (±25 to ±400), offline challenges, alerts |
| Gameplay – analysis | Engine eval after the game, coach's post-game recap, move timestamps, move-classification icons |
| Gameplay – puzzles | Difficulty (Standard, Hard, Extra hard, Random — all relative to your level); puzzle points vs "Classic Mode" rating only; puzzle goals; mistake feedback; chat hints; timer |
| Gameplay – history | Separate resets for rated puzzles, Puzzle Rush, endgames, practice positions, bot crowns, lessons |
| Coach | Pick one of 20 coach personas (David, Magnus, Levy, Hikaru, Judit, Mittens and others); coach after games, practice reminders, AI voice, skill highlights, auto-save coach games |
| Accessibility | Language (about 55 here, including three Chinese variants); content-language filter for news; voice control to speak moves; dark mode; high-contrast board presets; turn off special themes and animations |

**Takeaways for the Xiangqi site:** make the coach a setting with several personas and a voice; let each help layer (legal moves, hints, mistake feedback, post-game recap) be switched on or off; keep progress per feature with its own reset; build an accessible high-contrast board and a voice-move option from the start.

## Live human game screen (watched as a spectator)

The live game screen uses the same board and panel as everything else, plus clocks, chat and a running match score. Studied by watching a 3-minute rated game between two grandmasters (both rated about 3130) from the Watch tab, without playing.

**Finding a game to watch:** Play → Games → Watch lists live games of top players with title badges, ratings, flags and time control, a username search and a game-type filter. Clicking one opens it in place.

**Around the board**

- Each player bar: avatar, title badge, username, rating, flag, membership badge, connection-strength bars, captured pieces with a material difference (+1).
- The running **match score** sits beside each avatar (1.0, then 1.5 after a draw) when two players play repeated games.
- Clock box per side; the side to move has a highlighted clock with a timer icon.
- Optional eval bar and engine lines for spectators (Stockfish 19 Lite, depth climbing from 15 to 37 as you watch); off by default.

**Right panel tabs**

| Tab | Contents |
| --- | --- |
| Moves | Live opening name ("Queen's Gambit Declined: Semi-Tarrasch, Main Line"); move list with piece icons; a small bar per move showing **time spent** (e.g. 21.0s on a key move); analysis toggle |
| Chat | Spectator chat with message box and emoji; system lines for game events: "OBSERVING GAME …", "GM Indianlad offered a draw", "GAME OVER – Game drawn by agreement (3 min Rated)", "Match Scores … \[1.5\] vs \[1.5\]" |
| Info | Start time, time control, variant and rated status |
| Openings | Master Games lookup for the current position, opening line in full |

**Controls:** first / previous / play / next / last move; Share, Add to Collection, Flip Board, analysis; refresh and follow-live toggles.

**After the game:** the result is announced in chat, and the viewer **automatically follows the players into their next game** with colours swapped and the match score updated. The spectator never lands on a dead screen.

**Player-only controls not visible to a spectator** (still to check by playing): resign, draw offer button, abort, takeback request, rematch, premove, post-game review prompt.

## Classroom (teacher and student shared board)

[Classroom](https://www.chess.com/classroom) is a live shared analysis board with voice, video and chat, built for coach–student lessons. Checked by creating an empty room; nobody was invited.

**Entering:** New Room creates a room at a readable URL (three random words, e.g. `/classroom/better-watery-cocoa`), or Join Room takes a room ID. The intro modal lists its pitch: voice and video, load several games at once, save to Library Collections, room-management tools for coaching. A footer invites coaches to join the Coaches program.

**Loading material (Add Games):** Make Moves (blank board), Set Up Position, Game Collections, Load From Game History, Import Study, paste FEN/PGN or upload a PGN file. Several games can be queued and switched in a Games tab.

**Board panel:** the standard analysis panel with three tabs (Analysis, Games, Explore). Evaluation and Lines are **separate toggles**, so a teacher can show the eval bar without revealing best moves, or hide both. Also: move list with editable player names, play/step controls, download, add to collection.

**Room toolbar:** session clock, camera and microphone toggles, download, chat, participants.

**Participants and control**

- Each participant has a role shown under the name: the creator is "Black & White / Host", meaning they may move both colours. Per-person camera and mic indicators.
- Invite by username search or copy an invite link.
- **Open Enrollment** toggle: "While enabled, anyone with your room ID can join. Otherwise, participants must be individually invited."
- Manage menu: Mute all audio, Mute all chat, Kick all participants.

**For Xiangqi:** this maps directly to online Xiangqi teaching. The key ideas are host-controlled move rights per colour, separate eval/lines toggles, a multi-game lesson queue, and built-in audio/video so teachers don't need a separate meeting tool.

## Daily (correspondence) games

Daily Chess gives each player days per move, so one game can run for weeks and a member can play many at once. It suits learners who want time to think. Sources: the Play page and settings (seen), plus [What is Daily Chess?](https://support.chess.com/en/articles/8588171-what-is-daily-chess) and [What counts as cheating](https://support.chess.com/en/articles/8583921-what-counts-as-cheating-on-chess-com). No daily game was started.

**Time controls:** 1, 3 or 7 days per move by default; More Time Controls adds 2, 5 and 14 days and Custom. The same menu adds 30 sec, 20+1, 5+3, 20, 30 and 60 min live controls.

**Custom Daily challenge options**

| Setting | Detail |
| --- | --- |
| Type | Standard, Chess960, odds game or another variant |
| Opponent | Random, a friend, or a named member |
| Rating range | Recommended within 200 points |
| Rated | Off → also choose colour and whether takebacks are allowed (for teaching) |
| Move speed | Only opponents whose average move speed is equal to or slower than yours |
| Minimum games played | Opponent experience threshold |
| Avoid time-outs | Skip opponents with over 10% time-outs |
| Premium members only | Match only paying members (premium feature) |

**Rules and player settings**

- A game counts only after four moves; an earlier timeout or resignation changes no rating, but a mate within four moves does.
- Settings (seen earlier): confirm move, auto-claim win on time, after-move navigation (next game / game list / stay), days-per-move range for incoming challenges.
- **Vacation:** free members earn 2 days a month and store up to 15; premium earn 3 and store up to 30. Premium also gets automatic time-out protection.
- **Fair play differs from live:** books, opening databases without engine evaluation, and the in-game self-analysis board (including conditional moves) are allowed; engines, tablebases and help from others are not.

**Game archive:** the Game History page has tabs All, Favorites, Live, Daily, Bot, Coach, a grid or list view, and bulk tools (analyze, add to collection, download).

## Free vs paid limits

A free account gets **one full Game Review per day**. Re-opening a review already generated does not count, and Accuracy, move labels and Self Analysis stay free. Sources: [What does each level of premium membership get me?](https://support.chess.com/en/articles/8562418-what-does-each-level-of-premium-membership-get-me) and [How does Game Review work?](https://support.chess.com/en/articles/8584089-how-does-game-review-work).

| Feature | Free (Basic) | Gold | Platinum | Diamond |
| --- | --- | --- | --- | --- |
| Full Game Review | 1 per day | 1 per day | Unlimited | Unlimited + coach explanation on every move |
| Puzzles | 3 per day | Unlimited | Unlimited | Unlimited |
| Puzzle Rush / Battle | 5 on day one, then 1 each per day | Unlimited | Unlimited | Unlimited |
| Lessons | "New to Chess" + 1 lesson per day | Unlimited | Unlimited | Unlimited |
| Games vs Coach | 1 per month | Unlimited | Unlimited | Unlimited |
| Bots | 20+ personalities | All 100+ | All | All |
| Opening explorer | First 4 moves | Any depth, own games | Same | Same |
| Endgames, drills | First position per section, limited drills | All | All | All |
| Classroom | Create rooms, invite students one by one | + Open Enrollment | Same | Same |
| Insights, Advanced Stats, Cloud / deep analysis | No | No | No | Yes |
| Daily vacation | 2 days/month, store 15 | 3, store 30 | 3, store 30 | 3, store 30 |
| Ads | Yes | No | No | No |

Always free: unlimited games in every time control, variants, tournaments, clubs and forums, game archive, master-game library, blogs and news, themes.

**Retry your mistakes** (open item, now found): in the review walkthrough, each key move that could have been better offers **Retry** inside the coach's bubble. The player replays the position and is told the score they would have reached, or gets feedback on the wrong try. Hint buttons are labelled by idea ("Show Fork", "Show Lost Piece", "Show Checkmate", "Show Idea"). The first key move is the last book move; it names the opening, your record with it, and a suggested course.

**Review settings** (Interface → Review): which arrows to show (best move, coach visuals, both, none), key moves for you, your opponent or both, labels on the board, autoplay speed, coach avatar, course recommendations, Skills, time spent per move.

**Game Rating:** compares move quality with what's expected at the player's rating, giving a one-game performance rating. It averages out to the real rating over time and is less reliable when the rating gap is large, as in bot games ([source](https://support.chess.com/en/articles/10773754-how-is-game-rating-calculated-in-game-review)).

**Player-side live rules** ([abandonment](https://support.chess.com/en/articles/8593801-how-does-game-abandonment-work)), partly answering the open player-controls item:

- First-move timer: Bullet 15 s, Blitz 20 s, Rapid 60 s, else the game aborts. Repeat offenders lose instead.
- Reconnect window = (base + 40 × increment) × 10%, minimum 30 s, maximum 3 min. Only 15 s if the disconnected side is lost (− 3.5 or worse). It starts only on that player's turn.
- Long-move rule: using over 50% of base time on one move in the first 10 moves counts as abandonment.
- Both players disconnecting = 15 s grace, then a draw with no rating change.
- Repeated abandoners must acknowledge a warning before they can be matched again.

## Daily game screen and Vote Chess (spectated)

Both use the same board and panel. The daily screen is stripped of help for spectators because the game is still in progress. Vote Chess makes a whole club play one side.

**Daily game screen** — an ongoing unrated 3-day game, opened from the Daily leaderboard leader's profile

- Player bars show the days left on each clock ("3 days", "2 days") instead of minutes.
- Move list shows the **thinking time per move in real units** (3 mins, 8 hrs, 2 days) with a bar each, so a viewer sees where each side spent time.
- Tabs: Moves, Info (start date, time per move, variant, rated or unrated), Openings. **No Chat tab and no engine toggle** for spectators of an unfinished daily game, which matches the fair-play rule that engines are banned until it ends.
- Controls: move stepping, share, flip board.
- **Conditional moves** (player only, from the [help article](https://support.chess.com/en/articles/8583792-how-do-i-make-conditional-moves)): while the opponent is thinking, a Conditional Moves button lets you enter "if they play X, I play Y". You can add several lines with New Line, a reset and a trash icon; they save automatically, and an asterisk marks the button when any are active. Unlike premoves, they fire only if the opponent plays the exact predicted move.

**Vote Chess** — [votechess](https://www.chess.com/votechess)

- Clubs play each other; on each turn every club member votes for a move, and the move with the most votes is played.
- Hub: Open Games (filter: My, All, Club, Public), Leaderboard (club points, e.g. Chess School 31,528), Open Seeks, Create New, Completed Games shown as thumbnail boards with results and player counts.
- Game page: board with club names and avatars, days-per-move clock; tabs **Vote** (current move with % and vote count, e.g. "35. Qxb6 (100% 3 Votes)", with a bar and an arrow on the board), Moves, Info (result, dates, time per move, players per side, creator and acceptor). Below the board: a public discussion board with rich text and diagrams, and an Archive, so the team can debate moves.
- Create form: my club; opponent as open seek or specific club; game name; type (Standard, Chess960, book opening, custom FEN); minimum games; club size (under 20 to over 250 members); colour; time per move from 10 minutes to 7 days; description.

**For Xiangqi:** Vote Chess is a cheap way to give clubs and classes a shared game. A teacher's class can vote against another school's class, with the discussion thread as the lesson.

## Live game player screen (design spec)

The player screen should show only the controls that make sense at each moment of the game, protect players from mis-clicks and disconnects, and end every game with a clear next step (rematch, new game, review). Basis: what was observed on chess.com (bot game controls, spectator view, Gameplay settings, abandonment rules) plus standard practice on live game sites. Not verified by playing a rated human game on chess.com.

**Controls by game state**

| State | Visible controls | Behaviour |
| --- | --- | --- |
| Searching | Cancel search, chosen time control, players-online count | Show estimated wait; let the player change time control without leaving the page |
| Opponent found, before each side's first move | **Abort** (replaces Resign), chat | Abort ends the game with no rating change. First-move timer is visible as a countdown (e.g. 15/20/60 s by speed); if it expires the game aborts |
| In progress | **Resign** (flag), **Offer draw** (½), Takeback request (unrated/casual only), chat, flip board, settings, sound | Resign and draw need a second click to confirm (setting: Confirm Resign or Draw). Draw offers are rate-limited (e.g. one per N moves) to stop spam |
| Opponent offered a draw | Accept / Decline banner next to the clock | Offer expires when the receiver moves; no modal, so the receiver's clock is never blocked |
| Takeback requested | Accept / Decline banner | Only in unrated or teaching games; rated games hide the button |
| Opponent disconnected | Banner with reconnect countdown, then **Claim win** / **Claim draw** / Keep waiting | Countdown uses the reconnect formula; in a lost position the window is short |
| Low time | Clock turns red, optional tick sound | Setting: Low-Time Warning |
| Game over | Result card (result, reason, rating change ±), **Rematch**, **New game** (same time control), **Game Review**, share, download, add to collection | Rematch shows as a pending invite to the opponent; the next game swaps colours. Card can be closed to view the final position |

**Always on screen during play:** both clocks (active one highlighted), captured pieces and material difference, connection-strength indicator, move list with time per move, live opening name, premove indicator, last-move highlight.

**Safeguards against mis-clicks and misuse**

- Optional confirm-move for slow games; premoves for fast games (setting), cancelled by right-click.
- No engine, eval bar or hint in rated human games. Post-game analysis unlocks only after the result.
- Chat: mute opponent, report, chat off by default for children's accounts, profanity filter.
- Repeated aborts or abandonment: warning screen the player must acknowledge before matching again; scored as a loss for repeat offenders.
- Report player (cheating, abuse) from the game-over card and the player's name menu.

**Xiangqi-specific requirements**

- Draw handling must follow the chosen rule set: the server detects repetition and judges perpetual check and perpetual chase (长将 / 长捉). Show the ruling in the result card in plain words, e.g. "Red loses: perpetual check".
- A move-count draw rule (e.g. 60 moves without a capture in many rule sets) must be configurable and shown as a counter when it gets close.
- Clock types: base + increment and base + per-move time (步时 / byo-yomi). With 步时 the active clock shows both the remaining base time and the per-move countdown.
- Illegal move feedback: if a move leaves the General facing the other General (flying general) or in check, snap the piece back and show a one-line reason.
- Button labels in Chinese follow common usage: 认输 (resign), 求和 (offer draw), 悔棋 (takeback, casual only), 再来一局 (rematch).

## Xiangqi site requirements

The MVP should be a teaching site that also plays: a shared Xiangqi board, a rules engine, an in-browser engine, the beginner lesson path, puzzles and bots — all usable as a guest. Accounts, ratings and human play follow; paid content and community come last.

**What changes for Xiangqi** (domain notes, from general knowledge rather than the site study)

- **Board:** 9×10 grid, pieces sit on intersections; river in the middle; a 3×3 palace on each side with diagonals. Every chess.com board feature (drag, highlights, arrows, coordinates) must be rebuilt for intersections.
- **Pieces:** General 帅/将, Advisor 仕/士, Elephant 相/象, Horse 马, Chariot 车, Cannon 炮, Soldier 兵/卒. Offer a traditional character set and an icon set for non-Chinese readers.
- **Rules engine:** flying general (generals may not face each other on an open file), hobbled horse (蹩马腿), blocked elephant eye (塞象眼), elephant cannot cross the river, cannon captures over exactly one screen, soldier moves sideways after crossing the river, stalemate is a loss. Perpetual check and perpetual chase (长将 / 长捉) need adjudication; Asian (AXF) and Chinese rule sets differ, so the rule set must be configurable.
- **Notation and formats:** WXF notation (e.g. C2=5), Chinese notation (炮二平五), ICCS coordinates, Xiangqi FEN; import/export for games and positions in place of PGN.
- **Engine:** an open-source Xiangqi engine compiled to WebAssembly so analysis runs in the browser, as Stockfish does on chess.com. Candidates: Pikafish and Fairy-Stockfish (license and WASM build to confirm).
- **Content sources:** classical manuals (橘中秘, 梅花谱, 适情雅趣) for puzzles and composed endgames (排局); modern master games for the database.
- **Openings catalog:** grouped by first move, like chess.com's 1.e4 / 1.d4 — Central Cannon 中炮, Elephant 飞相, Pawn 仙人指路, Horse 起马; key replies such as Screen Horses 屏风马, Reverse Palace Horse 反宫马, Same-Direction 顺炮 and Opposite-Direction 列炮 Cannons.
- **Time controls:** chess.com's presets plus per-move time after the base clock (步时 / byo-yomi), which Chinese players expect.
- **Language:** bilingual Chinese and English from day one; piece names and notation follow the UI language.

**Requirements by phase**

| ID | Requirement | chess.com reference | Phase |
| --- | --- | --- | --- |
| R1 | Shared Xiangqi board component: drag or click to move, legal-move dots, last-move highlight, arrows, flip, coordinates, sounds | One board on every page | MVP |
| R2 | Rules engine with configurable rule set (Chinese / AXF), repetition and perpetual-check adjudication | Implicit in all play | MVP |
| R3 | In-browser engine: eval bar, top 3 lines, depth setting | Analysis board, Stockfish Lite | MVP |
| R4 | Analysis board: set up position, load/export FEN and notation, move tree with variations | [Analysis](https://www.chess.com/analysis) | MVP |
| R5 | Play vs bots: 8–10 graded bots with names, avatars, chat lines; hint, takeback, assist toggles | Play Bots | MVP |
| R6 | Learn path for beginners: one lesson per piece plus river, palace and checkmate basics; coach narration; star-capture challenges; progress bar | Learn To Play, The King lesson | MVP |
| R7 | Puzzles: rated puzzle stream from mate-in-1 upward, hint, retry, analyze, next | Solve Puzzles | MVP |
| R8 | Guest mode: everything above works without an account; prompt to sign up to save progress | Soft sign-up gates | MVP |
| R9 | Bilingual UI (Simplified Chinese, English) and two piece styles | 70 languages, piece themes | MVP |
| R10 | Accounts: email, phone, Google, Apple, WeChat sign-in; profile; saved games and lesson progress | Register page | Phase 2 |
| R11 | Online play vs humans: matchmaking by rating, time-control presets plus 步时, rated/unrated, challenge link, play a friend | Play Online | Phase 2 |
| R12 | Ratings (Glicko-2 or Elo) per time control and for puzzles; leaderboards | Leaderboards | Phase 2 |
| R13 | Game Review: accuracy score, move labels (Book, Best, Great, Inaccuracy, Mistake, Blunder), retry your mistakes | Game Review | Phase 2 |
| R14 | Openings explorer with win/draw/loss % per move and named openings catalog | [Openings](https://www.chess.com/openings) | Phase 2 |
| R15 | Endgame trainer vs engine with themes and Challenge Mode; composed-endgame library | [Endgames](https://www.chess.com/endgames) | Phase 2 |
| R16 | Puzzle Rush (3 min, 5 min, Survival) and Daily Puzzle | Puzzle Rush | Phase 2 |
| R17 | Play Coach: guided game where the coach explains plans and allows takebacks | Play Coach | Phase 3 |
| R18 | Lesson library by masters: video + interactive challenges, levels, instructor pages | [Lessons](https://www.chess.com/lessons) | Phase 3 |
| R19 | Paid courses marketplace with filters by level, aspect, color and position | [Courses](https://www.chess.com/courses/all) | Phase 3 |
| R20 | Classroom: teacher and students on one shared board | Classroom | Phase 3 |
| R21 | Arena tournaments and Puzzle Battle | Tournaments, Puzzle Battle | Phase 3 |
| R22 | Community: clubs, forums, friends, coach directory, news, event broadcasts | Community, Watch | Phase 3 |
| R23 | Membership tiers: free core play; paid review, explanations, stats, courses; no ads | [Membership](https://www.chess.com/membership) | Phase 3 |
| R24 | Anti-cheat: engine-use detection for rated games, report flow | Fair play | Phase 3 |

**Added after the logged-in pass**

| ID | Requirement | chess.com reference | Phase |
| --- | --- | --- | --- |
| R25 | Member home dashboard: continue cards (next lesson, next puzzle, last bot), recommended opponent, recent games with accuracy | Home | Phase 2 |
| R26 | Retention: daily streak with freeze, daily puzzle with solver count, weekly league ladder, notifications and practice reminders | Home, Coach settings | Phase 2 |
| R27 | Game Review layer 1: coach verdict, eval graph with clickable key moments, accuracy, move-label counts, "played like" game rating, phase grades | Game Review summary | Phase 2 |
| R28 | Game Review layer 2: move-by-move coach text, Explain (plays the refutation line), Best move, autoplay, share | Game Review walkthrough | Phase 2 |
| R29 | Skills tracker: concrete habits per category (e.g. for Xiangqi: develops chariots, central cannon, connects advisors) with target counts, fed by every game | Review → Skills | Phase 3 |
| R30 | Live coaching in Play Coach: comment and label each move as it is played; Casual / Balanced / Challenging levels adapting to the player | Play Coach | Phase 3 |
| R31 | Learning Rank ladder named after Xiangqi pieces (Soldier → General), counting mastered lessons | Learning Rank | Phase 2 |
| R32 | Puzzle points and levels alongside puzzle rating; difficulty choice relative to your level; coach goal and mistake feedback | Puzzles, Gameplay settings | Phase 2 |
| R33 | Insights: background analysis of all games; accuracy, openings, missed tactics (for Xiangqi: forks, pins, cannon-screen tactics, mates), move quality, time of day; compare to similar players | Insights | Phase 3 |
| R34 | Settings: board/piece themes with preview, move method, legal-move dots, premove, confirm move, challenge filters by rating, per-feature progress reset | Settings | Phase 2 |
| R35 | Coach personas (several characters, optional AI voice) chosen in settings and reused across review, puzzles and Play Coach | Coach settings | Phase 3 |
| R36 | Accessibility: high-contrast board presets, animations off, voice-move input, content-language filter | Accessibility settings | Phase 3 |
| R37 | Live game screen: player bars with title, rating, flag, connection, captured material; clocks; time-per-move bars; live opening name; chat with system event lines (draw offer, result, match score); Info and Openings tabs | Live game (spectated) | Phase 2 |
| R38 | Spectating: list of live top games with search and filter; optional spectator engine; running match score; auto-follow players into their next game | Play → Games → Watch | Phase 2 |
| R39 | Classroom: room by shareable ID, open enrollment or invite-only, per-person move rights by colour, separate eval and lines toggles, multi-game lesson queue, voice/video/chat, mute and kick controls | Classroom | Phase 3 |
| R40 | Daily (correspondence) Xiangqi: days per move (1–14), custom challenge filters, vacation days, game counts after 4 moves, self-analysis board allowed but engines banned | Daily Chess | Phase 2 |
| R41 | Live-game fair timing: first-move abort timer, reconnect window = (base + 40 × increment) × 10% (30 s–3 min), long-move rule in the first 10 moves, double-disconnect draw, warning for repeat abandoners | Abandonment rules | Phase 2 |
| R42 | Freemium metering: 1 full review, 3 puzzles and 1 lesson per day free; coach games per month; re-opening a generated review is free | Free vs paid limits | Phase 3 |
| R43 | Daily game screen: days-left clocks, per-move thinking time in real units, conditional moves (if-then lines), no engine or chat for spectators while the game is in progress | Daily game | Phase 2 |
| R44 | Vote Xiangqi: club vs club, members vote each move, vote tally with arrow on board, discussion thread, club points leaderboard, create form with custom start position | Vote Chess | Phase 3 |
| R45 | Live game player controls by state: abort before first moves, resign and draw offer with confirm, takeback only in unrated games, disconnect banner with claim win/draw, game-over card with rating change, rematch, new game and review | Live game (design spec) | Phase 2 |
| R46 | Xiangqi game-end rulings shown in plain words: repetition, perpetual check/chase, move-count draw counter; per-move time (步时) clock display; illegal-move reason | Live game (design spec) | Phase 2 |

**Added from the chess.com help center (2026-10-06).** About 100 articles on [support.chess.com](https://support.chess.com/en/) supplied the exact rules and numbers the screens don't show: move-quality bands, rating rules, streak grace, account deletion, age limits. Phase "MVP update" means a change to the live site with no backend; "v0.2" is the accounts release.

| ID | Requirement | chess.com reference | Phase |
| --- | --- | --- | --- |
| R47 | Move-quality bands by expected points lost: Best = the engine's move, Excellent ≤ 0.02, Good ≤ 0.05, Inaccuracy ≤ 0.10, Mistake ≤ 0.20, Blunder > 0.20; plus Book and Miss (failed to punish a mistake) | [Move classification](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc) | MVP update |
| R48 | Review loop: accuracy per side calibrated so most games score 50–95, eval graph, jump to the next key moment, Retry from the mistake; a per-game "game rating" that is clearly not the player's rating | [Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work), [Accuracy](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined) | MVP update (game rating v0.2) |
| R49 | Stars for each bot win: 3 with no help, 2 with 1–3 hints or takebacks, 1 with 4 or more | [Bots](https://support.chess.com/en/articles/8614091-how-can-i-play-against-the-chess-com-bots) | MVP update |
| R50 | Puzzle rating without inflation: a hint counts as a fail, no minimum gain, no participation points; difficulty Standard / Hard / Extra hard; no recent repeats | [Puzzle rating change](https://support.chess.com/en/articles/12488563-why-did-my-puzzle-rating-change), [Puzzle settings](https://support.chess.com/en/articles/8705896-how-do-i-manage-my-puzzle-settings) | MVP update |
| R51 | Puzzle Rush: 3 min, 5 min or Survival; three wrong answers end the run; best score kept; the missed puzzles listed to retry | [Puzzles](https://support.chess.com/en/articles/8608686-how-do-puzzles-work-on-chess-com) | MVP update |
| R52 | Daily puzzle: the same for everyone, picked from the date, changes at local midnight; calendar of solved days | [Daily Puzzle](https://support.chess.com/en/articles/8708990-how-do-i-find-the-daily-puzzle) | MVP update (calendar v0.2) |
| R53 | Streak: any game, puzzle, lesson or review counts for the day; 2 missed days are forgiven, the third resets it; lost streaks can't be restored | [Streaks](https://support.chess.com/en/articles/9714718-what-are-streaks) | MVP update (local), v0.2 (account) |
| R54 | Play options: confirm move, confirm resign, animation speed with Off, Red always at the bottom, abort before the first move; two-player mode gets auto-flip and an optional clock | [Live settings](https://support.chess.com/en/articles/8614003-how-do-i-manage-my-live-chess-settings), [Confirm move](https://support.chess.com/en/articles/8609803-how-do-i-turn-on-confirm-move), [Play in person](https://support.chess.com/en/articles/8583716-how-do-i-play-in-person-against-a-friend-on-the-app) | MVP update |
| R55 | Accessibility beyond chess.com: a published keyboard-shortcut list, moves announced in Chinese and WXF notation, colour-blind-safe themes, an accessibility statement | [Shortcuts](https://support.chess.com/en/articles/10319340-what-keyboard-shortcuts-can-i-use), [Voice moves](https://support.chess.com/en/articles/12872404-how-do-i-make-moves-using-my-voice) | MVP update |
| R56 | Help page: refresh and cache steps, supported browsers, a "new version available" prompt, and a bug-report link that fills in the version and browser | [Technical problems](https://support.chess.com/en/articles/8648692-i-m-having-technical-problems-what-should-i-do) | MVP update |
| R57 | Sign-up asks a skill level that sets the starting rating (chess.com: New 400, Beginner 800, Intermediate 1200, Advanced 1600); an unverified-email banner with resend and change email; clear reasons when an email is refused | [Create account](https://support.chess.com/en/articles/8584217-how-do-i-create-a-chess-com-account), [Activation](https://support.chess.com/en/articles/9834467-how-can-i-activate-my-account) | v0.2 |
| R58 | Usernames: 3 or more letters, digits, \_ or -, starting and ending with a letter or digit, not all digits; no profanity, politics or impersonation; one change every 90 days | [Username rules](https://support.chess.com/en/articles/8609530-what-kind-of-username-can-i-choose), [Change username](https://support.chess.com/en/articles/8557649-how-can-i-change-my-username) | v0.2 |
| R59 | Account security: password of 8+ characters checked against leaked lists; email change confirmed at the new address with a notice to the old one; a password change signs out other devices; Log out on all devices | [Change password](https://support.chess.com/en/articles/8572763-how-do-i-change-my-password), [Stay secure](https://support.chess.com/en/articles/8615124-how-can-i-stay-secure-on-chess-com), [Log out](https://support.chess.com/en/articles/8588481-how-do-i-log-out-of-my-account) | v0.2 |
| R60 | Delete account behind re-authentication, with a 10-day grace period that signing in cancels, then permanent; data export as a file | [Delete account](https://support.chess.com/en/articles/9829268-how-do-i-delete-my-chess-com-account), [My data](https://support.chess.com/en/articles/8598425-gdpr-and-the-right-to-be-forgotten-how-can-i-view-or-delete-my-account-data) | v0.2 |
| R61 | Minimum age by country (13 by default; 14 Italy, Korea; 15 France, Japan; 16 Germany, Spain, Netherlands, Poland; 18 Hong Kong, India); younger players get no social features, public profile or marketing email until a parent consents | [Parental consent](https://support.chess.com/en/articles/11070988-why-do-i-need-parental-consent) | v0.2 (consent flow later) |
| R62 | Rating rules: uncertainty grows with time away; a provisional mark while it is high; a game counts only if rated and at least 4 plies; bot games saved automatically from 4 plies; the result screen says why a rating didn't change; stats show peak with date, best win, longest streak, Red/Black split, 90 days by default | [Ratings](https://support.chess.com/en/articles/8566476-how-do-ratings-work-on-chess-com), [Rating didn't change](https://support.chess.com/en/articles/8614310-the-game-ended-and-my-rating-didn-t-change-at-all-why), [Stats](https://support.chess.com/en/articles/8705902-what-does-my-stats-page-show), [Saving bot games](https://support.chess.com/en/articles/8609271-can-i-save-my-games-against-the-bots) | v0.2 |
| R63 | Online-play safety: report and block in one form with chess.com's categories; game chat set to everyone, friends, presets only or off; for children, preset bilingual phrases only; a parent-set Safe Mode; at most 10 pending friend requests | [Report](https://support.chess.com/en/articles/8562517-how-do-i-report-someone), [Block](https://support.chess.com/en/articles/8609264-how-can-i-block-another-user), [Safe Mode](https://support.chess.com/en/articles/8614033-what-is-safe-mode-on-chess-com), [Quickchat](https://support.chess.com/en/articles/8659830-how-do-i-use-the-quickchat-tool-in-live-chess) | Phase 2 |

Where we go further than chess.com, on purpose:

- Bot games can be rated (chess.com never rates them), with a guard against farming weak bots.
- Guest progress moves into the account; chess.com keeps nothing from guest play.
- Nothing is locked for guests, and nothing is metered per day.
- Safe Mode is self-serve for parents; on chess.com only support can turn it on.
- The help center has no accessibility articles; we document shortcuts and screen-reader support.

## Open questions and logged-in checklist

The second pass, logged in, should answer these before the requirements are final.

**Check on chess.com after logging in**

- [x] Game Review report: layout, accuracy, Explain / Best walkthrough (see Game Review section)
- [x] Insights / Advanced Stats: sections and metrics
- [x] Lesson progress and Learning Rank
- [x] Board and piece settings, sounds, move confirmation, premoves
- [x] Retention mechanics: streak, league, daily puzzle, reminders
- [ ] Move Explanations (Diamond) beyond the Explain button: is there more detail per move?
- [x] Free-tier Game Review limit: 1 full review per day (see Free vs paid limits)
- [x] Retry-your-mistakes flow: Retry button on key moves in the review walkthrough (from the help center)
- [ ] Rating onboarding: does the skill survey set a starting rating? (needs a new account)
- [x] Daily game screen, conditional moves and Vote Chess (see their section)
- [x] Classroom: teacher controls done; the student's view needs a second account
- [x] Online game screen as a player: written as a design spec (see Live game player screen); optional check by playing one unrated game later
- [ ] Variants page and Play as a Guest matchmaking

**Decisions for the Xiangqi project**

- [ ] Primary market: mainland China, overseas Chinese, or non-Chinese learners? This drives sign-in (WeChat), hosting and licensing (ICP, real-name rules, minors' play-time limits if hosted in China).
- [ ] Default rule set: Chinese Xiangqi Association or AXF/WXF.
- [ ] Engine choice and license (Pikafish / Fairy-Stockfish are GPL), and whether server-side analysis is needed for Game Review.
- [ ] Puzzle and lesson content: build in-house, license, or adapt public-domain manuals.
- [ ] Rating system and whether to map ratings to Chinese grades (级位 / 段位).
- [ ] Competitors to study next: xiangqi.com, 天天象棋, 王者象棋 (named from general knowledge, not yet visited).
