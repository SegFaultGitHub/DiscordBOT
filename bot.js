var Discord = require('discord.io');
var logger = require('winston');
var auth = require('./auth.json');
var config = require('./config.json');

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
	colorize: true
});
logger.level = 'debug';

// Initialize Discord Bot
var client = new Discord.Client({
	token: auth.token,
	autorun: true
});

// Warnings
var warnings = {};
var timeouts = {};

function sendWarningMessage(channelID, userID) {
	var w = warnings.hasOwnProperty(userID) ? warnings[userID] : 0;
	client.sendMessage({
		to: channelID,
		message: "<@" + userID + ">, you have now " + w + " warning" + (w > 1 ? "s" : "") + "."
	});
}

function addWarning(channelID, userID) {
	if (!warnings.hasOwnProperty(userID)) warnings[userID] = 0;
	warnings[userID]++;
	if (warnings[userID] >= 3) {
		timeout(channelID, userID);
	}
	setTimeout(function() {
		warnings[userID]--;
	}, 15 * 60e3);
}

function timeout(channelID, userID) {
	if (!timeouts.hasOwnProperty(userID)) timeouts[userID] = new Date().getTime() + 60 * 1e3;
	client.sendMessage({
		to: channelID,
		message: "<@" + userID + ">, you have been timed out for one minute."
	});
	warnings[userID] = 0;
}

messageListeners = {
	filterTimeout: function(user, userID, channelID, message, evt) {
		if (timeouts.hasOwnProperty(userID) && timeouts[userID] < new Date().getTime()) {
			client.deleteMessage({
				channelID: channelID,
				messageID: evt.d.id
			});
		}
	},

	mentionBot: function(user, userID, channelID, message, evt) {
		evt.d.mentions.forEach(function(mention) {
			if (mention.id === client.id) {
				client.sendMessage({
					to: channelID,
					message: "Hello <@" + userID + ">"
				});
			}
		});
	},
	autoMention: function(user, userID, channelID, message, evt) {
		evt.d.mentions.forEach(function(mention) {
			if (mention.id === userID) {
				client.sendMessage({
					to: channelID,
					message: "Hey <@" + userID + ">, speaking to yourself?..."
				});
			}
		});
	},

	filterForbiddenWords: function(user, userID, channelID, message, evt) {
		message = message.toLowerCase();
		config.forbiddenWords.some(function(word) {
			if (message.indexOf(word) !== -1) {
				client.deleteMessage({
					channelID: channelID,
					messageID: evt.d.id
				});

				addWarning(channelID, userID);
				sendWarningMessage(channelID, userID);
				return true;
			}
		});
	},

	commands: function(user, userID, channelID, message, evt) {
		message = message.trim();
		if (message.substring(0, 1) == '!') {
			var args = message.substring(1).split(' ');
			var cmd = args[0];

			args = args.splice(1);
			switch (cmd) {
				case 'warnings':
					sendWarningMessage(channelID, userID);
					break;
			}
		}
	}
};

client.on('ready', function(evt) {
	logger.info('Connected');
	logger.info('Logged in as: ' + client.username + ' - (' + client.id + ')');
});

Object.keys(messageListeners).forEach(function(key) {
	client.on('message', messageListeners[key]);
});