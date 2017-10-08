var Discord = require("discord.io");
var logger = require("winston");
var auth = require("./auth.json");
var config = require("./config.json");
var async = require("async");

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
	colorize: true
});
logger.level = "debug";

// Initialize Discord Bot
var client = new Discord.Client({
	token: auth.token,
	autorun: true
});

// Warnings
var usersInfos = {};

function clientSendMessage(options, callback) {
	client.sendMessage(options, function(err, res) {
		setTimeout(function() {
			client.deleteMessage({
				channelID: res.channel_id,
				messageID: res.id
			});
		}, Number(options.expire) || 15 * 1e3);
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
			if (warningCount >= config.warningCount) {
				usersInfos[userID].messageTimeout = now(config.messageTimeout);
				usersInfos[userID].warnings = 0;
				clientSendMessage({
					to: channelID,
					message: "<@" + userID + ">, you have been timed out for one minute."
				}, callback);
			} else {
				clientSendMessage({
					to: channelID,
					message: "<@" + userID + ">, you have now " + warningCount + " warning" + (warningCount > 1 ? "s" : "") + "."
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
	clientSendMessage({
		to: channelID,
		message: "<@" + userID + ">, you have now " + w + " warning" + (w > 1 ? "s" : "") + "."
	}, callback);
}

function messageListener(user, userID, channelID, message, evt) {
	if (userID === client.id) return;

	loweredMessage = message.toLowerCase();
	trimedMessage = message.trim();
	async.waterfall([
		//addUserKey:
		function(callback) {
			if (!usersInfos.hasOwnProperty(userID)) {
				usersInfos[userID] = {
					messageTimeout: 0,
					warnings: 0,
					commandTimeout: 0
				};
				client.createDMChannel(userID, function(err, res) {
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
				return client.deleteMessage({
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
			async.some(config.forbiddenWords, function(word, callback) {
				if (loweredMessage.indexOf(word) !== -1) {
					return async.series([
						function(callback) {
							client.deleteMessage({
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
				if (mention.id === client.id) {
					return async.some(config.hellos, function(word, callback) {
						if (loweredMessage.indexOf(word) !== -1) {
							return clientSendMessage({
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
					return clientSendMessage({
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

				var channelToSend = config.sendDM ? usersInfos[userID].DMChannelID : channelID;

				switch (cmd) {
					case "warnings":
						usersInfos[userID].commandTimeout = now(config.commandTimeout);
						sendWarningMessage(channelToSend, userID, function(err, res) {
							if (err) return callback(err);
							return callback(null, true);
						});
						break;
					case "clean":
						usersInfos[userID].commandTimeout = now(config.commandTimeout);
						retry = true;
						before = null;
						async.whilst(function() {
							return retry;
						}, function(callback) {
							client.getMessages({
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
									return item.author.username === client.username;
								}).map(function(item) {
									return item.id
								});
								if (ids.length > 0) {
									client.deleteMessages({
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
				client.deleteMessage({
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
	});
};

client.on("ready", function(evt) {
	logger.info("Logged in as: " + client.username + " - (" + client.id + ")");
});

client.on("message", messageListener);
