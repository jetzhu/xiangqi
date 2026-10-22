# Children's data impact assessment

> This file is the master copy. Reviewed yearly with the [security programme](security-programme.md).

Oct 22, 2026 · Jet Zhu · For child profiles (M24, [v0.4-design.md](v0.4-design.md#child-profiles-m24)). It serves as the UK Children's Code / GDPR data protection impact assessment. China's assessment isn't needed while child profiles aren't offered there (decision E7). General information, not legal advice.

## The processing

| | |
| --- | --- |
| **Purpose** | Let a parent's child (under 13) learn Xiangqi with their progress saved, coached by the parent |
| **Data** | Nickname, birth year, country; lessons, puzzles, bot games, ratings, saved analyses, settings; the parent's consent record (their email, date, notice version, any typed statement) |
| **Not collected** | The child's email, password, name, photo, location, contacts; no online play, chat or messages |
| **Who sees it** | The parent; the child on the parent's device. Nobody else, no third-party disclosure |
| **Processors** | Supabase (storage, US), Gmail (emails to the parent) |
| **Retention** | Until the parent deletes it; unconfirmed 14 days; unused 24 months (warned at 23); consent records 3 years after the end |
| **Legal basis** | The parent's consent ("email plus"; Korea: a typed statement; Vietnam: the child's own agreement from 7) |

## Necessity and proportionality

- **Minimal data:** saving progress needs the play records. The birth year exists only to know when the child turns 13. The country decides the consent rules.
- **No online play, chat, public profile, leaderboard or outside coach,** so there is no contact with strangers and no disclosure.
- **Only the parent can open a profile, from their own account:** a child can't get into the parent's account through it, because returning means signing in again.
- **High-privacy defaults:** nothing about a child is public, ever.
- **Child-friendly transparency:** the profile always says "Your parent can see your progress here".

## Risks and measures

| Risk | Likelihood | Severity | Measures | Remaining |
| --- | --- | --- | --- | --- |
| A child creates a profile pretending to be a parent | Low | Medium | The parent must be 18+ by birth month, have a confirmed email, "confirm it's you", and confirm from that inbox | Low: "email plus" is not proof of identity, as the rules accept for non-disclosing sites |
| Someone else reads a child's data | Low | High | Row-level security, parent-checked functions, the second step for sensitive changes | Low |
| A stranger contacts the child | Very low | High | No online play, chat, messages or public presence | Very low |
| Data kept too long | Low | Medium | Retention jobs, parent deletion at once | Low |
| A breach at a processor | Low | High | Data minimisation (no names, emails or photos of children); incident plan | Low |
| Mainland China rules (PIPL, minors' online-game rules) | n/a | High | Not offered there (E7) | Revisit with a Chinese lawyer |

## Conclusion

The remaining risk is low and proportionate to a free, ad-free learning site. Review each October, or before adding anything that discloses a child's data, such as a second coach or online play. Either needs a stronger consent method first.
