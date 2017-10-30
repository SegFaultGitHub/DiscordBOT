"use strict";

var fs = require("fs");
var jimp = require("Jimp");
var path = require("path");

module.exports = function(callback) {
	function Cell() {
		this.visited = false;

		this.setVisited = function() {
			this.visited = true;
		};

		this.content = 0; // 0b0000

		this.setUp = function() {
			this.content |= 8; // 0b1000
		};
		this.setDown = function() {
			this.content |= 4; // 0b0100
		};
		this.setLeft = function() {
			this.content |= 2; // 0b0010
		};
		this.setRight = function() {
			this.content |= 1; // 0b0001
		};

		this.isUp = function() {
			return (this.content & 8 /*0b1000*/ ) !== 0;
		};
		this.isDown = function() {
			return (this.content & 4 /*0b0100*/ ) !== 0;
		};
		this.isLeft = function() {
			return (this.content & 2 /*0b0010*/ ) !== 0;
		};
		this.isRight = function() {
			return (this.content & 1 /*0b0001*/ ) !== 0;
		};
	}

	var Maze = function(dimensions) {
		this.dimensions = dimensions;

		this.isCellValid = function(x, y) {
			return x >= 0 && x < this.dimensions.width && y >= 0 && y < this.dimensions.height;
		};

		this.pickcell = function(current) {
			var toAdd = [{
				x: current.x - 1,
				y: current.y
			}, {
				x: current.x + 1,
				y: current.y
			}, {
				x: current.x,
				y: current.y - 1
			}, {
				x: current.x,
				y: current.y + 1
			}];
			var choices = Array();
			for (var i = 0; i < toAdd.length; i++) {
				var vector = toAdd[i];
				if (this.isCellValid(vector.x, vector.y))
					if (!this.cellArray[vector.x][vector.y].visited)
						choices.push(vector);
			}
			if (choices.length === 0) return null;
			else return choices[Math.floor(Math.random() * choices.length)];
		};

		this.continueGeneration = function() {
			if (this.path.length !== 0) {
				var current = this.path[this.path.length - 1];
				var next = this.pickcell(current);

				if (next === null) {
					this.path.pop();
					this.continueGeneration();
				} else {
					this.cellArray[next.x][next.y].visited = true;
					this.path.push(next);
					if (next.x === current.x - 1) {
						this.cellArray[current.x][current.y].setLeft();
						this.cellArray[next.x][next.y].setRight();
					} else if (next.x === current.x + 1) {
						this.cellArray[current.x][current.y].setRight();
						this.cellArray[next.x][next.y].setLeft();
					} else if (next.y === current.y - 1) {
						this.cellArray[current.x][current.y].setUp();
						this.cellArray[next.x][next.y].setDown();
					} else if (next.y === current.y + 1) {
						this.cellArray[current.x][current.y].setDown();
						this.cellArray[next.x][next.y].setUp();
					}
				}
			} else {
				this.finished = true;
			}
		};

		this.reset = function(dimensions) {
			this.finished = false;
			this.dimensions = dimensions;
			this.cellArray = new Array(this.dimensions.width);
			for (var i = 0; i < this.dimensions.width; i++) {
				this.cellArray[i] = new Array(this.dimensions.height);
				for (var j = 0; j < this.dimensions.height; j++) {
					this.cellArray[i][j] = new Cell(this.dimensions.format);
				}
			}
			this.path = [];
			var x = Math.floor(Math.random() * this.dimensions.width);
			var y = Math.floor(Math.random() * this.dimensions.height);
			this.path.push({
				x: x,
				y: y
			});
			this.cellArray[x][y].visited = true;
			this.cellArray[0][0].content = 8; // 0b1000
			this.cellArray[dimensions.width - 1][dimensions.height - 1].content = 4; // 0b0100
		};

		this.generate = function() {
			this.reset(this.dimensions);
			while (!this.finished) {
				this.continueGeneration();
			}
		};

		this.export = function(size, name, callback) {
			var i, j, ii, jj;
			var dimensions = this.dimensions;
			var cellArray = this.cellArray;
			new jimp(this.dimensions.width * size, this.dimensions.height * size, function(err, image) {
				for (i = 0; i < dimensions.width * size; i++) {
					for (j = 0; j < dimensions.height * size; j++) {
						image.setPixelColor(0xFFFFFFFF, i, j);
					}
				}
				for (i = 0; i < dimensions.width; i++) {
					for (j = 0; j < dimensions.height; j++) {
						var cell = cellArray[i][j];
						if (!cell.isUp()) {
							for (ii = i * size; ii < (i + 1) * size; ii++) {
								image.setPixelColor(0x000000FF, ii, j * size);
							}
						}
						if (!cell.isDown()) {
							for (ii = i * size; ii < (i + 1) * size; ii++) {
								image.setPixelColor(0x000000FF, ii, (j + 1) * size - 1);
							}
						}
						if (!cell.isLeft()) {
							for (jj = j * size; jj < (j + 1) * size; jj++) {
								image.setPixelColor(0x000000FF, i * size, jj);
							}
						}
						if (!cell.isRight()) {
							for (jj = j * size; jj < (j + 1) * size; jj++) {
								image.setPixelColor(0x000000FF, (i + 1) * size - 1, jj);
							}
						}
					}
				}
				name = path.resolve(".", "maze-" + name + ".png");
				image.write(name, function(err) {
					if (err) return callback({ err: err, mess: "error" });
					else return callback(null, name);
				});
			});
		};

		this.generate();
		return this;
	};

	return callback(null, Maze);
};