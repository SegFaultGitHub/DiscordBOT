var Discord = require("discord.io");
var logger = require("winston");
var auth = require("./auth.json");
var config = require("./config.json");
var async = require("async");
var redis = require("redis");
var merge = require("merge");
var fs = require("fs");

libs = {};
// Initilize libs
async.parallel({
	maze: require("./maze.js")
}, function(err, results) {
	libs = merge(results, libs);
});

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
var redisClient = redis.createClient({
	host: config.redis.host,
	port: config.redis.port
});
redisClient.select(config.redis.db, function(err) {
	if (err) return logger.error(err);
	logger.info("Redis client connected to db" + config.redis.db);
	redisClient.setnx("mazeTimeout", 0);
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
			redisClient.hget(userID, "warnings", callback);
		},
		function(warnings, callback) {
			redisClient.hset(userID, "warnings", Number(warnings) + 1, function(err) {
				if (err) return callback(err);
				return callback(null, Number(warnings) + 1);
			});
		},
		function(warningCount, callback) {
			if (warningCount >= botConfig.warningCount) {
				async.waterfall([
					function(callback) {
						logger.info(1);
						redisClient.hset(userID, "messageTimeout", now(botConfig.messageTimeout), function(err) {
							if (err) return callback(err);
							return callback();
						});
					},
					function(callback) {
						logger.info(2);
						redisClient.hset(userID, "warnings", 0, function(err) {
							if (err) return callback(err);
							return callback();
						});
					},
					function(callback) {
						logger.info(3);
						discordClientSendMessage({
							to: channelID,
							message: "<@" + userID + ">, tu as été timeout pendant une minute.",
							expire: 15
						}, function(err) {
							if (err) return callback(err);
							return callback();
						});
					},
					function(callback) {
						logger.info(4);
						redisClient.hget(userID, "timeouts", callback);
					},
					function(timeouts, callback) {
						logger.info(5);
						redisClient.hset(userID, "timeouts", Number(timeouts) + 1, function(err) {
							if (err) return callback(err);
							return callback();
						});
					}
					// Send DM to server admin if to many bans
				], callback);
			} else {
				sendWarningMessage(channelID, userID, callback);
			}
		}
	], function(err, results) {
		if (err) {
			logger.error(err);
			return callback(err);
		}
		return callback();
	});
}

function sendWarningMessage(channelID, userID, callback) {
	async.waterfall([
		function(callback) {
			redisClient.hget(userID, "warnings", callback);
		},
		function(warnings, callback) {
			warnings = Number(warnings);
			discordClientSendMessage({
				to: channelID,
				message: "<@" + userID + ">, tu as " + warnings + " avertissement" + (warnings > 1 ? "s" : "") + ".",
				expire: 15
			}, callback);
		}
	], callback);
}


// TODO: clean commands
function messageListener(user, userID, channelID, message, evt) {
	if (userID === discordClient.id || botConfig.botlessChannelIDs.indexOf(channelID) !== -1) return;

	loweredMessage = message.toLowerCase();
	trimedMessage = message.trim();

	async.waterfall([
		//initRedisKey:
		function(callback) {
			async.parallel([
				function(callback) {
					redisClient.hset(userID, "username", user, callback);
				},
				function(callback) {
					redisClient.hsetnx(userID, "warnings", 0, callback);
				},
				function(callback) {
					redisClient.hsetnx(userID, "messageTimeout", 0, callback);
				},
				function(callback) {
					redisClient.hsetnx(userID, "commandTimeout", 0, callback);
				},
				function(callback) {
					redisClient.hsetnx(userID, "timeouts", 0, callback);
				}
			], function(err) {
				if (err) return callback(err);
				return callback();
			});
		},

		// filterTimeout:
		function(callback) {
			async.waterfall([
				function(callback) {
					redisClient.hget(userID, "messageTimeout", callback);
				},
				function(messageTimeout, callback) {
					messageTimeout = Number(messageTimeout);
					if (messageTimeout >= now()) {
						return discordClient.deleteMessage({
							channelID: channelID,
							messageID: evt.d.id
						}, function(err) {
							if (err) return callback(err);
							return callback("User timed out.");
						});
					} else {
						return callback();
					}
				}
			], function(err) {
				if (err) return callback(err);
				return callback();
			});
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
							addWarning(channelID, userID, callback);
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
								message: "Salut <@" + userID + "> !"
							}, function(err) {
								return callback(null, true);
							});
						}
						return callback(null, false);
					}, callback);
				}
				return callback();
			}, function(err) {
				if (err) return callback(err);
				return callback();
			});
		},
		//howAreYouBot:
		function(callback) {
			async.each(evt.d.mentions, function(mention, callback) {
				if (mention.id === discordClient.id) {
					return async.some(botConfig.howAreYous, function(word, callback) {
						if (loweredMessage.indexOf(word) !== -1) {
							return discordClientSendMessage({
								to: channelID,
								message: "Ça va, merci <@" + userID + "> :)"
							}, function(err) {
								return callback(null, true);
							});
						}
						return callback(null, false);
					}, callback);
				}
				return callback();
			}, function(err) {
				if (err) return callback(err);
				return callback();
			});
		},
		//autoMention:
		function(callback) {
			async.each(evt.d.mentions, function(mention, callback) {
				if (mention.id === userID) {
					return discordClientSendMessage({
						to: channelID,
						message: "Hé <@" + userID + ">, tu parles tout seul ?..."
					}, callback);
				}
				return callback();
			}, function(err) {
				if (err) return callback(err);
				return callback();
			});
		},

		//commands:
		function(callback) {
			async.waterfall([
				function(callback) {
					redisClient.hget(userID, "commandTimeout", function(err, res) {
						if (err) return callback(err);
						return callback(null, {
							command: res
						});
					});
				},
				function(timeouts, callback) {
					redisClient.get("mazeTimeout", function(err, res) {
						if (err) return callback(err);
						return callback(null, merge(timeouts, {
							maze: res
						}));
					});
				},
				function(timeouts, callback) {
					timeouts.command = Number(timeouts.command);
					if (trimedMessage.substring(0, 1) == "!") {
						redisClient.hset(userID, "commandTimeout", now(botConfig.commandTimeout), function(err) {
							if (err) return callback(err);
							return callback(null, timeouts.command < now(), timeouts);
						});
					} else {
						return callback(null, false, {});
					}
				},
				function(command, timeouts, callback) {
					if (command) {
						var args = message.substring(1).split(" ");
						var cmd = args[0];

						args = args.splice(1);

						var channelToSend = channelID;

						switch (cmd) {
							case "warnings":
								sendWarningMessage(channelToSend, userID, function(err, res) {
									if (err) return callback(err);
									return callback(null, true);
								});
								break;
							case "clean":
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
											return item.id;
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
							case "god":
								discordClientSendMessage({
									to: channelID,
									message: "Gloire à <@" + botConfig.god + ">, notre Dieu à tous."
								}, function(err, res) {
									if (err) return callback(err);
									return callback(null, true);
								});
								break;
							case "maze":
								if (timeouts.maze < now()) {
									logger.info("Maze");
									var width = Math.min(Number(args[0]) || 30, botConfig.maze.maxWidth);
									var height = Math.min(Number(args[1]) || 30, botConfig.maze.maxHeight);
									var size = Math.min(Number(args[2]) || 30, botConfig.maze.maxSize);
									var maze = libs.maze({
										width:  width,
										height: height
									});
									async.waterfall([
										// setMazeTimeout
										function(callback) {
											redisClient.set("mazeTimeout", now(botConfig.maze.timeout), callback);
										},
										// generateImage:
										function(_, callback) {
											maze.export(size, userID + "-" + now(), callback);
										},
										// sendImage:
										function(name, callback) {
											discordClient.uploadFile({
												to: channelID,
												file: name
											}, function(err) {
												if (err) return	callback(err);
												else return callback(null, name);
											});
										},
										// deleteImage:
										function(name, callback) {
											fs.unlink(name, callback);
										}
									], function(err) {
										if (err) {
											discordClientSendMessage({
												to: channelID,
												message: "<@" + userID + ">, oops, je n'ai pas pu générer un labyrinthe !\r" + err
											}, function(err) {
												if (err) return callback(err);
												return callback(null, true);
											});
										} else {
											return callback(null, true);
										}
									});
								} else {
									discordClientSendMessage({
										to: channelID,
										message: "<@" + userID + ">, attends un peu, je suis fatigué..."
									}, function(err) {
										if (err) return callback(err);
										return callback(null, false);
									});
								}
								break;
							default:
								return callback(null, false);
						}
					} else {
						return callback(null, false);
					}
				}
			], callback);
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
		logger.info("Done");
	});
}

discordClient.on("ready", function(evt) {
	logger.info("Logged in as: " + discordClient.username + " - (" + discordClient.id + ")");
});

discordClient.on("message", messageListener);