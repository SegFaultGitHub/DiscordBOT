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
var warnings = {};
var timeouts = {};

function addWarning(channelID, userID, callback) {
	async.waterfall([
		function(callback) {
			usersInfos[userID].warnings++;
			return callback(null, usersInfos[userID].warnings);
		},
		function(warningCount, callback) {
			if (warningCount >= config.warningCount) {
				usersInfos[userID].timeout = new Date().getTime() + config.timeoutDuration * 1e3;
				usersInfos[userID].warnings = 0;
				client.sendMessage({
					to: channelID,
					message: "<@" + userID + ">, you have been timed out for one minute."
				}, callback);
			} else {
				client.sendMessage({
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
	client.sendMessage({
		to: channelID,
		message: "<@" + userID + ">, you have now " + w + " warning" + (w > 1 ? "s" : "") + "."
	}, callback);
}

function messageListener(user, userID, channelID, message, evt) {
	if (userID === client.id) return;

	loweredMessage = message.toLowerCase();
	trimedMessage = message.trim();
	async.series({
		addUserKey: function(callback) {
			if (!usersInfos.hasOwnProperty(userID)) {
				usersInfos[userID] = {
					timeout: 0,
					warnings: 0
				};
			}
			return callback();
		},

		filterTimeout: function(callback) {
			if (usersInfos[userID].timeout >= new Date().getTime()) {
				return client.deleteMessage({
					channelID: channelID,
					messageID: evt.d.id
				}, function(err) {
					return callback("User timed out.");
				});
			}
			return callback();
		},

		greetBot: function(callback) {
			async.each(evt.d.mentions, function(mention, callback) {
				if (mention.id === client.id) {
					return async.some(config.hellos, function(word, callback) {
						if (loweredMessage.indexOf(word) !== -1) {
							return client.sendMessage({
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
		autoMention: function(callback) {
			async.each(evt.d.mentions, function(mention, callback) {
				if (mention.id === userID) {
					return client.sendMessage({
						to: channelID,
						message: "Hey <@" + userID + ">, speaking to yourself?..."
					}, callback);
				}
				return callback();
			}, callback);
		},

		filterForbiddenWords: function(callback) {
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
						return callback(null, true);
					});
				}
				return callback(null, false);
			}, callback);
		},

		commands: function(callback) {
			if (trimedMessage.substring(0, 1) == "!") {
				var args = message.substring(1).split(" ");
				var cmd = args[0];

				args = args.splice(1);
				switch (cmd) {
					case "warnings":
						sendWarningMessage(channelID, userID, callback);
						break;
				}
			} else {
				return callback();
			}
		}
	}, function(err, results) {
		if (err) logger.error(err);
		logger.info(JSON.stringify(usersInfos[userID], null, 2));
	});
};

client.on("ready", function(evt) {
	logger.info("Logged in as: " + client.username + " - (" + client.id + ")");
});

client.on("message", messageListener);
