# smurf-node

Gathers Steam account and game stats for each player in a given CS:GO server.

# Setup & installation

1. Clone or download the repository

2. Run `npm install` in the project directory

3. Rename `config.example.js` to `config.js` and set the value of `STEAM_API_KEY` as your Steam API key

4. `npm start` to build the script.

5. Rename `status.example.md` to `status.md`

# Usage

* Type `status` in the CS:GO console and paste the output to `status.md`

* Run `node app.js`

A markdown formatted table will be generated in `out.md`

Blank values indicate that the statistic is undefined or that the user's profile is private.

If the VAC value is `true`, then the user has at least 1 VAC ban on record.