# cc-group-randomizer
# Group Randomizer

A web app that randomizes groups of people while avoiding repeated pairings across weeks.

## Features

- Add and remove people at any time
- Generate groups with anti-repeat logic (pair-count scoring)
- Preview groups before saving
- Generate multiple weeks at once, each week avoiding prior weeks' pairings
- View history and statistics (most frequent pairings)
- Data saved automatically in the browser (localStorage)
- Export/import your data as JSON

## How to publish on GitHub Pages

1. Create a new public repository on GitHub, e.g. `group-randomizer`.
2. Upload `index.html`, `style.css`, `script.js`, and this `README.md` to the repository.
3. Go to the repository's **Settings** → **Pages**.
4. Under "Build and deployment", set **Source** to `Deploy from a branch`.
5. Choose branch `main` and folder `/ (root)`, then click **Save**.
6. Wait ~1 minute. Your app will be live at:
   `https://YOUR-USERNAME.github.io/group-randomizer/`

## How it works

Each pair of people who have been in the same group before is counted.
When generating new groups, the algorithm repeatedly shuffles people,
calculates a score based on how often each pair has already been together
(squared to heavily penalize repeats), then tries small swaps between
groups to improve the score. The best result across many attempts is used.

## Local use

You don't need a server. Just open `index.html` in any modern browser.

## Data

Your data lives only in your browser. Clearing your browser data will
erase it. 
- Export weekly groups and pair counts to CSV (open in Excel/Sheets)
- Import people from a CSV file
