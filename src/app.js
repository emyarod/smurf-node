import fs from 'fs';
import request from 'request';
import big from 'big.js';
import moment from 'moment';
import STEAM_API_KEY from './config';

const readStatus = new Promise((resolve, reject) => {
  fs.readFile('status.md', 'utf8', (err, data) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
});

const APIKey = STEAM_API_KEY;

/**
 * steamIDToSteamID64() converts legacy Steam ID format to 64-bit STEAM ID
 * Legacy Steam ID format is: V = STEAM_X:Y:Z
 * To convert to 64-bit systems, use the formula W = V + (Z * 2) + Y
 * @param {String} legacyID - a unique legacy Steam ID
 * @return {String} 64-bit Steam ID
 */
function steamIDToSteamID64(legacyID) {
  const steamID64 = big('76561197960265728');
  const [, Y, Z] = legacyID.split(':');

  return steamID64.plus(big(Z).times(2)).plus(Y).valueOf();
}

/** Class representing a Player */
class Player {
  /**
   * Create a CS:GO Player object
   * @param {String} steamID64 - 64-bit Steam ID
   * @param {String} handle - Username
   * @param {String} country - Country (if provided)
   * @param {Boolean} publicProfile - Whether or not the profile is publicly accessible
   * @param {String} profileURL - Steam Community URL to profile
   * @param {String} avatar - Steam Community avatar
   * @param {String} accountAge - Unix timestamp of account creation date (if accessible)
   */
  constructor(steamID64, handle, country, publicProfile, profileURL, avatar, accountAge = null) {
    this.steamID64 = steamID64;
    this.handle = `[${handle}](${profileURL})`;
    this.country = country;
    this.publicProfile = publicProfile;
    this.profileURL = profileURL;
    this.avatar = `![${handle}](${avatar})`;

    // set account age based on whether or not profile is private
    if (accountAge) {
      // convert time from X UNIX time
      this.accountAge = moment.unix(accountAge).from(this, true);
    } else {
      this.accountAge = accountAge;
    }
  }
}

/**
 * getSummaries() takes an array of 64-bit steam IDs and returns an array of Player objects
 * with properties taken from the Steam API
 * @param {Array} steamID64sarray - array containing each player's 64-bit Steam ID
 * @return {Array} array containing Player objects for each player on the server
 */
function getSummaries(steamID64sarray) {
  const steamID64s = steamID64sarray.join();
  const resourceURL = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${APIKey}&steamids=${steamID64s}`;

  // API call
  return new Promise((resolve, reject) => {
    request(resourceURL, (error, response, body) => {
      const players = [];
      if (error) {
        reject(error);
      } else if (!error && response.statusCode === 200) {
        const { response: { players: APIresponse } } = JSON.parse(body);
        APIresponse.forEach((element) => {
          const handle = element.personaname;
          const steamID64 = element.steamid;
          const profileURL = element.profileurl;
          const avatar = element.avatar;
          const country = element.loccountrycode;

          // check if profile is private
          if (element.communityvisibilitystate === 3) {
            const age = element.timecreated;
            players.push(new Player(steamID64, handle, country, true, profileURL, avatar, age));
          } else {
            players.push(new Player(steamID64, handle, country, false, profileURL, avatar));
          }
        }, this);
      }

      resolve(players);
    });
  });
}

/**
 * checkVAC() takes an array of 64-bit Steam IDs and sends a query to the Steam API
 * to get VAC ban details. The function then compares the results from the API
 * with each Player in the array, and returns a new array of updated Player objects
 * @param {Array} steamID64sarray - array containing 64-bit Steam IDs
 * @param {Array} playersArray - array of Player objects
 * @return {Array} revised array containing VAC ban properties for each Player
 */
function checkVAC(steamID64sarray, playersArray) {
  const steamID64s = steamID64sarray.join();
  const VACURL = `http://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${APIKey}&steamids=${steamID64s}`;

  // API call
  return new Promise((resolve, reject) => {
    request(VACURL, (error, response, body) => {
      if (error) {
        reject(error);
      } else if (!error && response.statusCode === 200) {
        const APIresponse = JSON.parse(body).players;

        // map through array of Player objects
        const players = playersArray.map((element) => {
          const player = element;
          APIresponse.forEach((resElement) => {
            // match Steam IDs and append VACBanned property
            if (player.steamID64 === resElement.SteamId) {
              player.VACBanned = resElement.VACBanned;
            }
          }, this);

          return player;
        });

        resolve(players);
      }
    });
  });
}

/**
 * getStats() takes a Player and the response body from a Steam API call
 * and returns a revised Player object with added properties
 * @param {Player} playerObject - Player object
 * @param {Object} body - JSON response from Steam API
 * @return {Player} revised Player containing game stats properties
 */
function getStats(playerObject, body) {
  const player = playerObject;
  const stats = body.playerstats.stats;

  // hsp
  const [{ value: headshots }] = stats.filter((stat) => (
    stat.name === 'total_kills_headshot'
  ));
  const [{ value: totalKills }] = stats.filter((stat) => (
    stat.name === 'total_kills'
  ));

  // acc
  const [{ value: totalShotsHit }] = stats.filter((stat) => (
    stat.name === 'total_shots_hit'
  ));
  const [{ value: totalShotsFired }] = stats.filter((stat) => (
    stat.name === 'total_shots_fired'
  ));

  // winrate
  const [{ value: matchesWon }] = stats.filter((stat) => (
    stat.name === 'total_matches_won'
  ));
  const [{ value: matchesPlayed }] = stats.filter((stat) => (
    stat.name === 'total_matches_played'
  ));

  // kdr
  const [{ value: deaths }] = stats.filter((stat) => (
    stat.name === 'total_deaths'
  ));

  player.kdr = big(totalKills / deaths).round(2).valueOf();
  player.hsp = `${big(headshots / totalKills).times(100).round(2).valueOf()}%`;
  player.acc = `${big(totalShotsHit / totalShotsFired).times(100).round(2).valueOf()}%`;
  player.winrate = `${big(matchesWon / matchesPlayed).times(100).round(2).valueOf()}%`;
  return player;
}

/**
 * getPlaytime() takes a Player and the response body from a Steam API call
 * and returns a revised Player object with added properties
 * @param {Player} playerObject - Player object
 * @param {Object} body - JSON response from Steam API
 * @return {Player} revised Player containing playtime properties
 */
function getPlaytime(playerObject, body) {
  const player = playerObject;
  const [filtered] = body.response.games.filter((value) => value.appid === 730);
  const recentPlaytime = filtered.playtime_2weeks;
  const totalPlaytime = filtered.playtime_forever;
  player.recentPlaytime = big(recentPlaytime).div(60).round(2).valueOf();
  player.totalPlaytime = big(totalPlaytime).div(60).round(2).valueOf();
  return player;
}

/**
 * getFriends() takes a Player and the response body from a Steam API call
 * and returns a revised Player object with added properties
 * @param {Player} playerObject - Player object
 * @param {Object} body - JSON response from Steam API
 * @return {Array} revised Player containing a property with the player's friends list
 */
function getFriends(playerObject, body) {
  const player = playerObject;
  player.friends = body.friendslist.friends;
  return player;
}

/**
 * apiCall() takes the array of Player objects and feeds each element of the array
 * into a child function based on the endpoint parameter provided
 * @param {Array} players - array of Player objects
 * @param {String} endpoint - describes which child function to use
 * @return {Array} array of revised Player objects after passing through child functions
 */
function apiCall(players, endpoint) {
  const fn = (element) => {
    const player = element;
    return new Promise((resolve, reject) => {
      if (player.publicProfile) {
        let resourceURL;
        if (endpoint === 'stats') {
          resourceURL = `http://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v0002/?appid=730&key=${APIKey}&steamid=${player.steamID64}`;
        } else if (endpoint === 'playtime') {
          resourceURL = `http://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${APIKey}&steamid=${player.steamID64}&format=json`;
        } else if (endpoint === 'friends') {
          resourceURL = `http://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${APIKey}&steamid=${player.steamID64}&relationship=friend`;
        }

        request(resourceURL, (error, response, body) => {
          if (error) {
            reject(error);
          } else if (!error && response.statusCode === 200) {
            let method;
            if (endpoint === 'stats') {
              method = getStats(player, JSON.parse(body));
            } else if (endpoint === 'playtime') {
              method = getPlaytime(player, JSON.parse(body));
            } else if (endpoint === 'friends') {
              method = getFriends(player, JSON.parse(body));
            }

            resolve(method);
          }
        });
      } else {
        resolve(player);
      }
    });
  };

  const actions = players.map(fn);
  const results = Promise.all(actions);
  return results;
}


/**
 * checkFriends() takes the array of Player objects and loops through each player's friends list
 * if a user's friend has the same Steam ID as another user in the server
 * the function will push the names of the friendpair as well as the duration of their friendship
 * to a new array to be returned
 * @param {Array} playersArray - array of Player objects
 * @return {Array} array of friendpairs found on the given server
 */
function checkFriends(playersArray) {
  const confirmedFriends = [];
  playersArray.forEach((user) => {
    if (user.publicProfile) {
      user.friends.forEach((friend) => {
        playersArray.forEach((player) => {
          if (player.steamID64 === friend.steamid) {
            const friendDate = moment.unix(friend.friend_since).toNow(true);

            // push friendpair if array is empty
            if (!confirmedFriends.length) {
              confirmedFriends.push([player.handle, user.handle, friendDate]);
            }

            let found = false;

            // check if friendpair exists in array already
            confirmedFriends.forEach((element) => {
              if (element.indexOf(player.handle) !== -1 && element.indexOf(user.handle) !== -1) {
                found = true;
              }
            }, this);

            // push friendpair if not found in array
            if (!found) {
              confirmedFriends.push([player.handle, user.handle, friendDate]);
            }
          }
        }, this);
      }, this);
    }
  }, this);

  return confirmedFriends;
}

// readfile
readStatus
  .then((result) => {
    const legacyIDs = [];
    result.split('\n').forEach((element) => {
      if (element.match(/(#)( ).*?(STEAM)(_)(\d+)(:)(\d+)(:)(\d+)/)) {
        legacyIDs.push(element.match(/STEAM_\d+:\d+:\d+/)[0]);
      }
    }, this);

    // convert legacy IDs to 64-bit IDs
    const steamID64s = [];
    legacyIDs.forEach((element) => {
      steamID64s.push(steamIDToSteamID64(element));
    }, this);

    return steamID64s;
  })
  .then((steamID64s) => (
    // create Player objects
    getSummaries(steamID64s).then((players) => checkVAC(steamID64s, players))
  ))
  .then((players) => (
    // get player stats for CS:GO
    apiCall(players, 'stats').then((statsAdded) => statsAdded)
  ))
  .then((statsAdded) => (
    // get playtime stats
    apiCall(statsAdded, 'playtime').then((playtimeAdded) => playtimeAdded)
  ))
  .then((playtimeAdded) => (
    // get friends list
    apiCall(playtimeAdded, 'friends').then((friendsAdded) => (
      friendsAdded
    ))
  ))
  .then((friendsAdded) => {
    // output table headers
    const headers = [
      { Avatar: 'avatar' },
      { Handle: 'handle' },
      { Country: 'country' },
      { 'Account age': 'accountAge' },
      { 'Recent playtime (hours)': 'recentPlaytime' },
      { 'Total playtime (hours)': 'totalPlaytime' },
      { KDR: 'kdr' },
      { HSP: 'hsp' },
      { Accuracy: 'acc' },
      { 'Win Rate': 'winrate' },
      { VAC: 'VACBanned' },
    ];

    let output = '| ';

    headers.forEach((header) => {
      output += `${Object.keys(header)[0]} | `;
    }, this);

    output += '\n| ';

    for (let i = 0; i < headers.length; i++) {
      output += '--- | ';
    }

    output += '\n| ';

    // output each player's values for each category
    friendsAdded.forEach((player) => {
      headers.forEach((header) => {
        const [key] = Object.keys(header);
        const value = player[header[key]];
        if (value === null || value === undefined) {
          output += '- | ';
        } else {
          output += `${value} | `;
        }
      }, this);

      output += '\n';
    }, this);

    output += '\n';

    // append checkFriends output
    const confirmedFriends = checkFriends(friendsAdded);
    confirmedFriends.forEach((element) => {
      const [friendA, friendB, duration] = element;
      output += `${friendA} has been friends with ${friendB} for ${duration}\n\n`;
    }, this);

    // write to file
    fs.writeFile('out.md', output, 'utf8', (err) => {
      if (err) throw err;
      console.log('saved');
    });
  });
