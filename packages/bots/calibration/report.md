# Bot calibration

400 bot-vs-bot games with the site's Fairy-Stockfish build and move choice (`scripts/calibrate.mjs`). Ratings are fitted on the Elo scale, draws as half a point, with the average fixed at the average of the current labels (994); only the gaps are measured.

| Bot | Label | Fitted | 95 % range | Engine time per move |
| --- | --- | --- | --- | --- |
| Little Soldier | 250 | -2 | -233–58 | 9 ms |
| Grandpa Fu | 400 | 234 | 15–313 | 12 ms |
| Xiaoyu | 600 | 553 | 369–628 | 16 ms |
| Old Chen | 800 | 802 | 599–906 | 25 ms |
| Meiling | 1000 | 1055 | 847–1205 | 38 ms |
| Aqiang | 1300 | 1332 | 1101–1505 | 129 ms |
| Teacher Lin | 1600 | 1766 | 1603–1982 | 375 ms |
| Dragon King | 2000 | 2210 | 2001–3213 | 3492 ms |

| Pairing | Games | Score of the first | Draws |
| --- | --- | --- | --- |
| afu vs laochen | 20 | 5 % | 0 |
| xiaoyu vs laochen | 40 | 15 % | 2 |
| xiaobing vs xiaoyu | 20 | 0 % | 0 |
| afu vs xiaoyu | 40 | 15 % | 0 |
| xiaobing vs afu | 40 | 23 % | 2 |
| xiaoyu vs meiling | 20 | 13 % | 1 |
| laochen vs meiling | 40 | 18 % | 2 |
| aqiang vs longwang | 20 | 5 % | 0 |
| laochen vs aqiang | 20 | 0 % | 0 |
| meiling vs aqiang | 40 | 20 % | 0 |
| teacherlin vs longwang | 40 | 5 % | 2 |
| meiling vs teacherlin | 20 | 0 % | 0 |
| aqiang vs teacherlin | 40 | 6 % | 1 |
