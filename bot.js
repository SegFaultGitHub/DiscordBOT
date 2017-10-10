var Discord = require("discord.io");
var logger = require("winston");
var auth = require("./auth.json");
var config = require("./config.json");
var async = require("async");
var redis = require("redis");

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
	colorize: true
});
logger.level = "debug";

// Initialize Discord Bot
var discordClient = new Discord.Client({
	token: auth.token,
	autorun: true
});
var botConfig = config.botConfig;
var usersInfos = undefined;
var redisClient = redis.createClient({
	host: config.redis.host,
	port: config.redis.port
});

function discordClientSendMessage(options, callback) {
	if (!options.to) return callback("No channelID set.");
	discordClient.sendMessage(options, function(err, res) {
		if (options.expire)
		setTimeout(function() {
			discordClient.deleteMessage({
				channelID: res.channel_id,
				messageID: res.id
			});
		}, options.expire * 1e3);
		return callback(err, res);
	});
}

function now(plus) {
	return new Date().getTime() + (plus || 0) * 1e3;
}

function addWarning(channelID, userID, callback) {
	async.waterfall([
		function(callback) {
			usersInfos[userID].warnings++;
			return callback(null, usersInfos[userID].warnings);
		},
		function(warningCount, callback) {
			if (warningCount >= botConfig.warningCount) {
				usersInfos[userID].messageTimeout = now(botConfig.messageTimeout);
				usersInfos[userID].warnings = 0;
				discordClientSendMessage({
					to: channelID,
					message: "<@" + userID + ">, you have been timed out for one minute.",
					expire: 15
				}, callback);
			} else {
				discordClientSendMessage({
					to: channelID,
					message: "<@" + userID + ">, you have now " + warningCount + " warning" + (warningCount > 1 ? "s" : "") + ".",
					expire: 15
				}, callback);
			}
		}
	], function(err, results) {
		if (err) {
			logger.error(err);
			return callback(err);
		}
		return callback();
	})
}

function sendWarningMessage(channelID, userID, callback) {
	var w = usersInfos[userID].warnings || 0;
	discordClientSendMessage({
		to: channelID,
		message: "<@" + userID + ">, you have now " + w + " warning" + (w > 1 ? "s" : "") + ".",
		expire: 15
	}, callback);
}

function messageListener(user, userID, channelID, message, evt) {
	if (userID === discordClient.id) return;

	discordClientSendMessage({
		to: botConfig.defaultChannelID,
		message: JSON.stringify(evt, null, 2)
	}, function(err) {
		logger.info(JSON.stringify(evt, null, 2));
		if (err) logger.error(err);
	});

	loweredMessage = message.toLowerCase();
	trimedMessage = message.trim();
	async.waterfall([
		//retrieveRedisData:
		function(callback) {
			if (!usersInfos) {
				redisClient.get("usersInfos", function(err, data) {
					logger.info(data);
					if (err) {
						logger.error("Failed to get Redis data");
						usersInfos = {};
					} else {
						usersInfos = JSON.parse(data) || {};
					}
					return callback();
				});
			} else {
				return callback();
			}
		},

		//addUserKey:
		function(callback) {
			if (!usersInfos.hasOwnProperty(userID)) {
				usersInfos[userID] = {
					messageTimeout: 0,
					warnings: 0,
					commandTimeout: 0
				};
				discordClient.createDMChannel(userID, function(err, res) {
					usersInfos[userID].DMChannelID = res.id;
					return callback(err);
				});
			} else {
				return callback();
			}
		},

		//filterTimeout:
		function(callback) {
			if (usersInfos[userID].messageTimeout >= now()) {
				return discordClient.deleteMessage({
					channelID: channelID,
					messageID: evt.d.id
				}, function(err) {
					return callback("User timed out.");
				});
			}
			return callback();
		},
		//filterForbiddenWords:
		function(callback) {
			async.some(botConfig.forbiddenWords, function(word, callback) {
				if (loweredMessage.indexOf(word) !== -1) {
					return async.series([
						function(callback) {
							discordClient.deleteMessage({
								channelID: channelID,
								messageID: evt.d.id
							}, callback);
						},
						function(callback) {
							addWarning(channelID, userID, callback)
						}
					], function(err) {
						if (err) return callback(err);
						return callback(null, true);
					});
				}
				return callback(null, false);
			}, function(err, res) {
				if (err || res) return callback("Forbidden word.");
				return callback();
			});
		},

		//greetBot:
		function(callback) {
			async.each(evt.d.mentions, function(mention, callback) {
				if (mention.id === discordClient.id) {
					return async.some(botConfig.hellos, function(word, callback) {
						if (loweredMessage.indexOf(word) !== -1) {
							return discordClientSendMessage({
								to: channelID,
								message: "Hello <@" + userID + ">!"
							}, function(err) {
								return callback(null, true);
							});
						}
						return callback(null, false);
					}, callback);
				}
				return callback();
			}, callback);
		},
		//autoMention:
		function(callback) {
			async.each(evt.d.mentions, function(mention, callback) {
				if (mention.id === userID) {
					return discordClientSendMessage({
						to: channelID,
						message: "Hey <@" + userID + ">, speaking to yourself?..."
					}, callback);
				}
				return callback();
			}, callback);
		},

		//commands:
		function(callback) {
			if (usersInfos[userID].commandTimeout >= now()) return callback();
			if (trimedMessage.substring(0, 1) == "!") {
				var args = message.substring(1).split(" ");
				var cmd = args[0];

				args = args.splice(1);

				var channelToSend = botConfig.sendDM ? usersInfos[userID].DMChannelID : channelID;

				switch (cmd) {
					case "warnings":
					usersInfos[userID].commandTimeout = now(botConfig.commandTimeout);
					sendWarningMessage(channelToSend, userID, function(err, res) {
						if (err) return callback(err);
						return callback(null, true);
					});
					break;
					case "clean":
					usersInfos[userID].commandTimeout = now(botConfig.commandTimeout);
					retry = true;
					before = null;
					async.whilst(function() {
						return retry;
					}, function(callback) {
						discordClient.getMessages({
							channelID: channelID,
							before: before
						}, function(err, res) {
							if (err) return callback(err);
							if (res.length === 0) {
								retry = false;
								return callback();
							}
							retry = res.length === 50;
							before = res[res.length - 1].id;
							var ids = res.filter(function(item) {
								return item.author.username === discordClient.username;
							}).map(function(item) {
								return item.id
							});
							if (ids.length > 0) {
								discordClient.deleteMessages({
									channelID: channelID,
									messageIDs: ids
								}, callback);
							} else {
								return callback();
							}
						});
					}, function(err) {
						if (err) return callback(err);
						return callback(null, true);
					});
					break;
					default:
					return callback(null, false);
					break;
				}
			} else {
				return callback(null, false);
			}
		},
		// deleteCommandMessage:
		function(del, callback) {
			if (del) {
				discordClient.deleteMessage({
					channelID: channelID,
					messageID: evt.d.id
				}, callback);
			} else {
				return callback();
			}
		}
	], function(err) {
		if (err) logger.error(err);
		logger.info(JSON.stringify(usersInfos[userID], null, 2));
		redisClient.set("usersInfos", JSON.stringify(usersInfos), function(err) {
			logger.info("usersInfos updated");
		});
	});
};

discordClient.on("ready", function(evt) {
	logger.info("Logged in as: " + discordClient.username + " - (" + discordClient.id + ")");
});

discordClient.on("message", messageListener);

discordClient.on("presence", function(user, userID, status, game, evt) {
	// logger.info(JSON.stringify({
	// 	user: user,
	// 	userID: userID,
	// 	status: status,
		// game: game,
	// 	evt: evt
	// }, null, 2));
	if (game) {
		var title;
		if (game.hasOwnProperty("name")) title = user + " en stream sur *" + game.name + "* ici !"
		else title = user + " en stream ici !"
		discordClientSendMessage({
			to: botConfig.defaultChannelID,
			message: "@everyone\n" + botConfig.startStreamMessage.replace("{ID}", userID),
			embed: {
				title: user + " en stream sur " + game.name + " ici !",
				url: "https://www.google.com",
				thumbnail: {
					url: "https://www.google.com"
				},
				type: "link"
			}
		}, function(err) {
			if (err) logger.error(err);
		});
	}
});
