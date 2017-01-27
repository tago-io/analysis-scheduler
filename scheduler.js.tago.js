/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	const Analysis = __webpack_require__(1);
	const Utils = __webpack_require__(2);
	const Service = __webpack_require__(3);
	const Device = __webpack_require__(4);
	const converter = __webpack_require__(5);
	const axios = __webpack_require__(47);
	const co = __webpack_require__(89);
	const url_node = __webpack_require__(71);

	function check_url(url) {
	    if (url.indexOf('docs.google.com') === -1 && url.indexOf('spreadsheets') === -1) return url;
	    const parse_url = url_node.parse(url);
	    let pathname = parse_url.pathname.split("/");
	    pathname = pathname.find(x => x.length >= 25); //need to improve this logic?

	    url = `https://spreadsheets.google.com/feeds/download/spreadsheets/Export?key=${ pathname }&exportFormat=csv`;
	    return url;
	}

	function convert_to_json(data_csv) {
	    return new Promise((resolve, reject) => {
	        const options = {
	            "delimiter": {
	                "eol": "\r"
	            }
	        };

	        converter.csv2json(data_csv, options, (err, result) => {
	            if (err) return reject("Can't convert csv to json. Something ins't right");
	            const object_return = {};

	            Object.keys(result).forEach(key => {
	                object_return[key.toLowerCase()] = result[key];
	            });

	            resolve(object_return);
	        });
	    });
	}

	function transform_loc(location) {
	    return new Promise((resolve, reject) => {
	        if (!location || location === '') return resolve(null);

	        location = location.split(";");
	        if (location.length < 2) return reject("Invalid Location");
	        try {
	            location = { "lat": Number(location[1]), "lng": Number(location[0]) };
	        } catch (error) {
	            return reject(error);
	        }
	        resolve(location);
	    });
	}

	/**
	 * Create a scheduler based in a URL from GoogleDrive or another source.
	 * Reserverd variables: email, email_msg, color, location, reset_here and time.
	 * @param  {object} context - from tago
	 */
	function run_scheduler(context) {
	    context.log("Running script");
	    const env_var = Utils.env_to_obj(context.environment);
	    if (!env_var.url) return context.log("Missing url environment variable");
	    if (!env_var.device_token) return context.log("Missing url environment variable");

	    const mydevice = new Device(env_var.device_token);

	    co(function* () {
	        const url = check_url(env_var.url);
	        const request = yield axios.get(url).catch(console.log);
	        if (!request.data && typeof request.data !== "string") return context.log("Can't access the URL");

	        const data_list = yield convert_to_json(request.data);
	        if (!data_list || !data_list[0]) return context.log("Tago can't get the excel archive by the URL. Something wrong happens");

	        let stepnow = yield mydevice.find({ "variable": "stepnow", "query": "last_value" });
	        stepnow = stepnow[0] ? stepnow[0].value : 0;

	        const data = data_list[stepnow] ? data_list[stepnow] : data_list[0];
	        const serie = new Date().getTime();
	        const location = yield transform_loc(data.location);
	        const color = data.color;
	        const reset = data.reset_here;
	        let time;

	        function send_email() {
	            context.log('Sending email...');
	            const email_service = new Service(context.token).email;
	            email_service.send(data.email, 'Tago Scheduler', data.email_msg);
	        }

	        if (data.email_msg && data.email_msg !== '' && data.email) send_email();
	        ["time", "color", "email_msg", "email", "reset_here"].forEach(x => delete data[x]);

	        function format_var(variable, value) {
	            let final_value;
	            try {
	                final_value = Number(value) || value;
	            } catch (e) {
	                final_value = value;
	            }

	            let data_to_insert = {
	                "variable": variable,
	                "value": final_value,
	                "serie": serie
	            };

	            if (time) data_to_insert.time = time;
	            if (location) data_to_insert.location = location;
	            if (color) data_to_insert.metadata = { color };

	            return data_to_insert;
	        }

	        const data_to_insert = [];
	        Object.keys(data).forEach(key => {
	            data_to_insert.push(format_var(key, data[key]));
	        });

	        data_to_insert.push({
	            "variable": "stepnow",
	            "value": data_list[stepnow + 1] ? stepnow + 1 : 0,
	            serie
	        });

	        if (reset) {
	            const remove_all = data_to_insert.map(x => mydevice.remove(x.variable, 'all'));
	            const result = yield Promise.all(remove_all);
	            context.log("Data Removed", result);
	        }

	        yield mydevice.insert(data_to_insert);
	        context.log("Succesfully Inserted schedule data");
	    }).catch(context.log);
	}

	module.exports = new Analysis(run_scheduler, 'c685b3c0-d9c3-11e6-b110-c75bdbcc1b6d');

/***/ },
/* 1 */
/***/ function(module, exports) {

	module.exports = require("tago/analysis");

/***/ },
/* 2 */
/***/ function(module, exports) {

	module.exports = require("tago/utils");

/***/ },
/* 3 */
/***/ function(module, exports) {

	module.exports = require("tago/services");

/***/ },
/* 4 */
/***/ function(module, exports) {

	module.exports = require("tago/device");

/***/ },
/* 5 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var json2Csv = __webpack_require__(6),
	    // Require our json-2-csv code
	csv2Json = __webpack_require__(46),
	    // Require our csv-2-json code
	constants = __webpack_require__(8),
	    // Require in constants
	docPath = __webpack_require__(9),
	    _ = __webpack_require__(7); // Require underscore

	/**
	 * Default options
	 */
	var defaultOptions = constants.DefaultOptions;

	var isDefined = function (val) {
	    return !_.isUndefined(val);
	};

	var copyOption = function (options, lowercasePath, uppercasePath) {
	    var lowerCaseValue = docPath.evaluatePath(options, lowercasePath);
	    if (isDefined(lowerCaseValue)) {
	        docPath.setPath(options, uppercasePath, lowerCaseValue);
	    }
	};

	/**
	 * Build the options to be passed to the appropriate function
	 * If a user does not provide custom options, then we use our default
	 * If options are provided, then we set each valid key that was passed
	 */
	var buildOptions = function (opts, cb) {
	    // PREVIOUS VERSION SUPPORT (so that future versions are backwards compatible)
	    // Issue #26: opts.EOL should be opts.DELIMITER.EOL -- this will move the option & provide backwards compatibility
	    if (docPath.evaluatePath(opts, 'EOL')) {
	        docPath.setPath(opts, 'DELIMITER.EOL', opts.EOL);
	    }

	    // #62: Allow for lower case option names
	    if (opts) {
	        copyOption(opts, 'prependHeader', 'PREPEND_HEADER');
	        copyOption(opts, 'trimHeaderFields', 'TRIM_HEADER_FIELDS');
	        copyOption(opts, 'sortHeader', 'SORT_HEADER');
	        copyOption(opts, 'parseCsvNumbers', 'PARSE_CSV_NUMBERS');
	        copyOption(opts, 'keys', 'KEYS');
	        copyOption(opts, 'checkSchemaDifferences', 'CHECK_SCHEMA_DIFFERENCES');
	        copyOption(opts, 'emptyFieldValue', 'EMPTY_FIELD_VALUE');
	        if (isDefined(opts.delimiter)) {
	            copyOption(opts, 'delimiter.field', 'DELIMITER.FIELD');
	            copyOption(opts, 'delimiter.array', 'DELIMITER.ARRAY');
	            copyOption(opts, 'delimiter.wrap', 'DELIMITER.WRAP');
	            copyOption(opts, 'delimiter.eol', 'DELIMITER.EOL');
	        }
	    }

	    opts = _.defaults(opts || {}, defaultOptions);

	    // Note: _.defaults does a shallow default, we need to deep copy the DELIMITER object
	    opts.DELIMITER = _.defaults(opts.DELIMITER || {}, defaultOptions.DELIMITER);

	    // If the delimiter fields are the same, report an error to the caller
	    if (opts.DELIMITER.FIELD === opts.DELIMITER.ARRAY) {
	        return cb(new Error(constants.Errors.delimitersMustDiffer));
	    }

	    // Otherwise, send the options back
	    return cb(null, opts);
	};

	// Export the following functions that will be client accessible
	module.exports = {

	    /**
	     * Client accessible json2csv function
	     * Takes an array of JSON documents to be converted, a callback that will be called with (err, csv)
	     * after processing is complete, and optional options
	     * @param array Object[] data to be converted
	     * @param callback Function callback
	     * @param opts Object options object
	     */
	    json2csv: function (array, callback, opts) {
	        // If this was promisified (callback and opts are swapped) then fix the argument order.
	        if (_.isObject(callback) && !_.isFunction(callback)) {
	            var func = opts;
	            opts = callback;
	            callback = func;
	        }

	        buildOptions(opts, function (err, options) {
	            // Build the options
	            if (err) {
	                return callback(err);
	            } else {
	                json2Csv.json2csv(options, array, callback); // Call our internal json2csv function
	            }
	        });
	    },

	    /**
	     * Client accessible csv2json function
	     * Takes a string of CSV to be converted to a JSON document array, a callback that will be called
	     * with (err, json) after processing is complete, and optional options
	     * @param csv
	     * @param callback
	     * @param opts
	     */
	    csv2json: function (csv, callback, opts) {
	        // If this was promisified (callback and opts are swapped) then fix the argument order.
	        if (_.isObject(callback) && !_.isFunction(callback)) {
	            var func = opts;
	            opts = callback;
	            callback = func;
	        }

	        buildOptions(opts, function (err, options) {
	            // Build the options
	            if (err) {
	                return callback(err);
	            } else {
	                csv2Json.csv2json(options, csv, callback); // Call our internal csv2json function
	            }
	        });
	    }
	};

/***/ },
/* 6 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var _ = __webpack_require__(7),
	    constants = __webpack_require__(8),
	    path = __webpack_require__(9),
	    promise = __webpack_require__(10);

	var options = {}; // Initialize the options - this will be populated when the json2csv function is called.

	/**
	 * Retrieve the headings for all documents and return it.
	 * This checks that all documents have the same schema.
	 * @param data
	 * @returns {promise}
	 */
	var generateHeading = function (data) {
	    if (options.KEYS) {
	        return promise.resolve(options.KEYS);
	    }

	    var keys = _.map(data, function (document, indx) {
	        // for each key
	        if (_.isObject(document)) {
	            // if the data at the key is a document, then we retrieve the subHeading starting with an empty string heading and the doc
	            return generateDocumentHeading('', document);
	        }
	    });

	    var uniqueKeys = [];

	    // If the user wants to check for the same schema:
	    if (options.CHECK_SCHEMA_DIFFERENCES) {
	        // Check for a consistent schema that does not require the same order:
	        // if we only have one document - then there is no possibility of multiple schemas
	        if (keys && keys.length <= 1) {
	            return promise.resolve(_.flatten(keys) || []);
	        }
	        // else - multiple documents - ensure only one schema (regardless of field ordering)
	        var firstDocSchema = _.flatten(keys[0]),
	            schemaDifferences = 0;

	        _.each(keys, function (keyList) {
	            // If there is a difference between the schemas, increment the counter of schema inconsistencies
	            var diff = _.difference(firstDocSchema, _.flatten(keyList));
	            if (!_.isEqual(diff, [])) {
	                schemaDifferences++;
	            }
	        });

	        // If there are schema inconsistencies, throw a schema not the same error
	        if (schemaDifferences) {
	            return promise.reject(new Error(constants.Errors.json2csv.notSameSchema));
	        }

	        uniqueKeys = _.flatten(keys[0]);
	    } else {
	        // Otherwise, we do not care if the schemas are different, so we should merge them via union:
	        _.each(keys, function (keyList) {
	            uniqueKeys = _.union(uniqueKeys, _.flatten(keyList));
	        });
	    }

	    if (options.SORT_HEADER) {
	        uniqueKeys.sort();
	    }

	    return promise.resolve(uniqueKeys);
	};

	/**
	 * Takes the parent heading and this doc's data and creates the subdocument headings (string)
	 * @param heading
	 * @param data
	 * @returns {Array}
	 */
	var generateDocumentHeading = function (heading, data) {
	    var keyName = ''; // temporary variable to aid in determining the heading - used to generate the 'nested' headings

	    var documentKeys = _.map(_.keys(data), function (currentKey) {
	        // If the given heading is empty, then we set the heading to be the subKey, otherwise set it as a nested heading w/ a dot
	        keyName = heading ? heading + '.' + currentKey : currentKey;

	        // If we have another nested document, recur on the sub-document to retrieve the full key name
	        if (_.isObject(data[currentKey]) && !_.isNull(data[currentKey]) && !_.isArray(data[currentKey]) && _.keys(data[currentKey]).length) {
	            return generateDocumentHeading(keyName, data[currentKey]);
	        }
	        // Otherwise return this key name since we don't have a sub document
	        return keyName;
	    });

	    return documentKeys; // Return the headings in an array
	};

	/**
	 * Convert the given data with the given keys
	 * @param data
	 * @param keys
	 * @returns {Array}
	 */
	var convertData = function (data, keys) {
	    // Reduce each key in the data to its CSV value
	    return _.reduce(keys, function (output, key) {
	        // Retrieve the appropriate field data
	        var fieldData = path.evaluatePath(data, key);
	        if (_.isUndefined(fieldData)) {
	            fieldData = options.EMPTY_FIELD_VALUE;
	        }
	        // Add the CSV representation of the data at the key in the document to the output array
	        return output.concat(convertField(fieldData));
	    }, []);
	};

	/**
	 * Convert the given value to the CSV representation of the value
	 * @param value
	 * @param output
	 */
	var convertField = function (value) {
	    if (_.isArray(value)) {
	        // We have an array of values
	        var result = [];
	        value.forEach(function (item) {
	            if (_.isObject(item)) {
	                // use JSON stringify to convert objects in arrays, otherwise toString() will just return [object Object]
	                result.push(JSON.stringify(item));
	            } else {
	                result.push(convertValue(item));
	            }
	        });
	        return options.DELIMITER.WRAP + '[' + result.join(options.DELIMITER.ARRAY) + ']' + options.DELIMITER.WRAP;
	    } else if (_.isDate(value)) {
	        // If we have a date
	        return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP;
	    } else if (_.isObject(value)) {
	        // If we have an object
	        return options.DELIMITER.WRAP + convertData(value, _.keys(value)) + options.DELIMITER.WRAP; // Push the recursively generated CSV
	    } else if (_.isNumber(value)) {
	        // If we have a number (avoids 0 being converted to '')
	        return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP;
	    } else if (_.isBoolean(value)) {
	        // If we have a boolean (avoids false being converted to '')
	        return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP;
	    }
	    value = options.DELIMITER.WRAP && value ? value.replace(new RegExp(options.DELIMITER.WRAP, 'g'), "\\" + options.DELIMITER.WRAP) : value;
	    return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP; // Otherwise push the current value
	};

	var convertValue = function (val) {
	    // Convert to string
	    val = _.isNull(val) || _.isUndefined(val) ? '' : val.toString();

	    // Trim, if necessary, and return the correct value
	    return options.TRIM_FIELD_VALUES ? val.trim() : val;
	};

	/**
	 * Generate the CSV representing the given data.
	 * @param data
	 * @param headingKeys
	 * @returns {*}
	 */
	var generateCsv = function (data, headingKeys) {
	    // Reduce each JSON document in data to a CSV string and append it to the CSV accumulator
	    return [headingKeys].concat(_.reduce(data, function (csv, doc) {
	        return csv += convertData(doc, headingKeys).join(options.DELIMITER.FIELD) + options.DELIMITER.EOL;
	    }, ''));
	};

	module.exports = {

	    /**
	     * Internally exported json2csv function
	     * Takes options as a document, data as a JSON document array, and a callback that will be used to report the results
	     * @param opts Object options object
	     * @param data String csv string
	     * @param callback Function callback function
	     */
	    json2csv: function (opts, data, callback) {
	        // If a callback wasn't provided, throw an error
	        if (!callback) {
	            throw new Error(constants.Errors.callbackRequired);
	        }

	        // Shouldn't happen, but just in case
	        if (!opts) {
	            return callback(new Error(constants.Errors.optionsRequired));
	        }
	        options = opts; // Options were passed, set the global options value

	        // If we don't receive data, report an error
	        if (!data) {
	            return callback(new Error(constants.Errors.json2csv.cannotCallJson2CsvOn + data + '.'));
	        }

	        // If the data was not a single document or an array of documents
	        if (!_.isObject(data)) {
	            return callback(new Error(constants.Errors.json2csv.dataNotArrayOfDocuments)); // Report the error back to the caller
	        }
	        // Single document, not an array
	        else if (_.isObject(data) && !data.length) {
	                data = [data]; // Convert to an array of the given document
	            }

	        // Retrieve the heading and then generate the CSV with the keys that are identified
	        generateHeading(data).then(_.partial(generateCsv, data)).spread(function (csvHeading, csvData) {
	            // If the fields are supposed to be wrapped... (only perform this if we are actually prepending the header)
	            if (options.DELIMITER.WRAP && options.PREPEND_HEADER) {
	                csvHeading = _.map(csvHeading, function (headingKey) {
	                    return options.DELIMITER.WRAP + headingKey + options.DELIMITER.WRAP;
	                });
	            }

	            if (options.TRIM_HEADER_FIELDS) {
	                csvHeading = _.map(csvHeading, function (headingKey) {
	                    return headingKey.trim();
	                });
	            }

	            // If we are prepending the header, then join the csvHeading fields
	            if (options.PREPEND_HEADER) {
	                csvHeading = csvHeading.join(options.DELIMITER.FIELD);
	            }

	            // If we are prepending the header, then join the header and data by EOL, otherwise just return the data
	            return callback(null, options.PREPEND_HEADER ? csvHeading + options.DELIMITER.EOL + csvData : csvData);
	        }).catch(function (err) {
	            return callback(err);
	        });
	    }

	};

/***/ },
/* 7 */
/***/ function(module, exports) {

	module.exports = require("lodash");

/***/ },
/* 8 */
/***/ function(module, exports) {

	module.exports = {
		"Errors": {
			"delimitersMustDiffer": "The field and array delimiters must differ.",
			"callbackRequired": "A callback is required!",
			"optionsRequired": "Options were not passed and are required.",
			"json2csv": {
				"cannotCallJson2CsvOn": "Cannot call json2csv on ",
				"dataNotArrayOfDocuments": "Data provided was not an array of documents.",
				"notSameSchema": "Not all documents have the same schema."
			},
			"csv2json": {
				"cannotCallCsv2JsonOn": "Cannot call csv2json on ",
				"csvNotString": "CSV is not a string.",
				"noDataRetrieveHeading": "No data provided to retrieve heading."
			}
		},
		"DefaultOptions": {
			"DELIMITER": {
				"FIELD": ",",
				"ARRAY": ";",
				"WRAP": "",
				"EOL": "\n"
			},
			"PREPEND_HEADER": true,
			"TRIM_HEADER_FIELDS": false,
			"TRIM_FIELD_VALUES": false,
			"SORT_HEADER": false,
			"PARSE_CSV_NUMBERS": false,
			"KEYS": null,
			"CHECK_SCHEMA_DIFFERENCES": true,
			"EMPTY_FIELD_VALUE": "null"
		}
	};

/***/ },
/* 9 */
/***/ function(module, exports) {

	var controller = {};

	controller.evaluatePath = function (document, keyPath) {
	    if (!document) {
	        return null;
	    }
	    var indexOfDot = keyPath.indexOf('.');

	    // If there is a '.' in the keyPath and keyPath doesn't present in the document, recur on the subdoc and ...
	    if (indexOfDot >= 0 && !document[keyPath]) {
	        var currentKey = keyPath.slice(0, indexOfDot),
	            remainingKeyPath = keyPath.slice(indexOfDot + 1);

	        return controller.evaluatePath(document[currentKey], remainingKeyPath);
	    }

	    return document[keyPath];
	};

	controller.setPath = function (document, keyPath, value) {
	    if (!document) {
	        throw new Error('No document was provided.');
	    }

	    var indexOfDot = keyPath.indexOf('.');

	    // If there is a '.' in the keyPath, recur on the subdoc and ...
	    if (indexOfDot >= 0) {
	        var currentKey = keyPath.slice(0, indexOfDot),
	            remainingKeyPath = keyPath.slice(indexOfDot + 1);

	        if (!document[currentKey]) {
	            document[currentKey] = {};
	        }
	        controller.setPath(document[currentKey], remainingKeyPath, value);
	    } else {
	        document[keyPath] = value;
	    }

	    return document;
	};

	module.exports = controller;

/***/ },
/* 10 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var old;
	if (typeof Promise !== "undefined") old = Promise;
	function noConflict() {
	    try {
	        if (Promise === bluebird) Promise = old;
	    } catch (e) {}
	    return bluebird;
	}
	var bluebird = __webpack_require__(11)();
	bluebird.noConflict = noConflict;
	module.exports = bluebird;

/***/ },
/* 11 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function () {
	    var makeSelfResolutionError = function () {
	        return new TypeError("circular promise resolution chain\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	    };
	    var reflectHandler = function () {
	        return new Promise.PromiseInspection(this._target());
	    };
	    var apiRejection = function (msg) {
	        return Promise.reject(new TypeError(msg));
	    };
	    function Proxyable() {}
	    var UNDEFINED_BINDING = {};
	    var util = __webpack_require__(12);

	    var getDomain;
	    if (util.isNode) {
	        getDomain = function () {
	            var ret = process.domain;
	            if (ret === undefined) ret = null;
	            return ret;
	        };
	    } else {
	        getDomain = function () {
	            return null;
	        };
	    }
	    util.notEnumerableProp(Promise, "_getDomain", getDomain);

	    var es5 = __webpack_require__(13);
	    var Async = __webpack_require__(14);
	    var async = new Async();
	    es5.defineProperty(Promise, "_async", { value: async });
	    var errors = __webpack_require__(17);
	    var TypeError = Promise.TypeError = errors.TypeError;
	    Promise.RangeError = errors.RangeError;
	    var CancellationError = Promise.CancellationError = errors.CancellationError;
	    Promise.TimeoutError = errors.TimeoutError;
	    Promise.OperationalError = errors.OperationalError;
	    Promise.RejectionError = errors.OperationalError;
	    Promise.AggregateError = errors.AggregateError;
	    var INTERNAL = function () {};
	    var APPLY = {};
	    var NEXT_FILTER = {};
	    var tryConvertToPromise = __webpack_require__(18)(Promise, INTERNAL);
	    var PromiseArray = __webpack_require__(19)(Promise, INTERNAL, tryConvertToPromise, apiRejection, Proxyable);
	    var Context = __webpack_require__(20)(Promise);
	    /*jshint unused:false*/
	    var createContext = Context.create;
	    var debug = __webpack_require__(21)(Promise, Context);
	    var CapturedTrace = debug.CapturedTrace;
	    var PassThroughHandlerContext = __webpack_require__(22)(Promise, tryConvertToPromise);
	    var catchFilter = __webpack_require__(23)(NEXT_FILTER);
	    var nodebackForPromise = __webpack_require__(24);
	    var errorObj = util.errorObj;
	    var tryCatch = util.tryCatch;
	    function check(self, executor) {
	        if (typeof executor !== "function") {
	            throw new TypeError("expecting a function but got " + util.classString(executor));
	        }
	        if (self.constructor !== Promise) {
	            throw new TypeError("the promise constructor cannot be invoked directly\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	    }

	    function Promise(executor) {
	        this._bitField = 0;
	        this._fulfillmentHandler0 = undefined;
	        this._rejectionHandler0 = undefined;
	        this._promise0 = undefined;
	        this._receiver0 = undefined;
	        if (executor !== INTERNAL) {
	            check(this, executor);
	            this._resolveFromExecutor(executor);
	        }
	        this._promiseCreated();
	        this._fireEvent("promiseCreated", this);
	    }

	    Promise.prototype.toString = function () {
	        return "[object Promise]";
	    };

	    Promise.prototype.caught = Promise.prototype["catch"] = function (fn) {
	        var len = arguments.length;
	        if (len > 1) {
	            var catchInstances = new Array(len - 1),
	                j = 0,
	                i;
	            for (i = 0; i < len - 1; ++i) {
	                var item = arguments[i];
	                if (util.isObject(item)) {
	                    catchInstances[j++] = item;
	                } else {
	                    return apiRejection("expecting an object but got " + "A catch statement predicate " + util.classString(item));
	                }
	            }
	            catchInstances.length = j;
	            fn = arguments[i];
	            return this.then(undefined, catchFilter(catchInstances, fn, this));
	        }
	        return this.then(undefined, fn);
	    };

	    Promise.prototype.reflect = function () {
	        return this._then(reflectHandler, reflectHandler, undefined, this, undefined);
	    };

	    Promise.prototype.then = function (didFulfill, didReject) {
	        if (debug.warnings() && arguments.length > 0 && typeof didFulfill !== "function" && typeof didReject !== "function") {
	            var msg = ".then() only accepts functions but was passed: " + util.classString(didFulfill);
	            if (arguments.length > 1) {
	                msg += ", " + util.classString(didReject);
	            }
	            this._warn(msg);
	        }
	        return this._then(didFulfill, didReject, undefined, undefined, undefined);
	    };

	    Promise.prototype.done = function (didFulfill, didReject) {
	        var promise = this._then(didFulfill, didReject, undefined, undefined, undefined);
	        promise._setIsFinal();
	    };

	    Promise.prototype.spread = function (fn) {
	        if (typeof fn !== "function") {
	            return apiRejection("expecting a function but got " + util.classString(fn));
	        }
	        return this.all()._then(fn, undefined, undefined, APPLY, undefined);
	    };

	    Promise.prototype.toJSON = function () {
	        var ret = {
	            isFulfilled: false,
	            isRejected: false,
	            fulfillmentValue: undefined,
	            rejectionReason: undefined
	        };
	        if (this.isFulfilled()) {
	            ret.fulfillmentValue = this.value();
	            ret.isFulfilled = true;
	        } else if (this.isRejected()) {
	            ret.rejectionReason = this.reason();
	            ret.isRejected = true;
	        }
	        return ret;
	    };

	    Promise.prototype.all = function () {
	        if (arguments.length > 0) {
	            this._warn(".all() was passed arguments but it does not take any");
	        }
	        return new PromiseArray(this).promise();
	    };

	    Promise.prototype.error = function (fn) {
	        return this.caught(util.originatesFromRejection, fn);
	    };

	    Promise.getNewLibraryCopy = module.exports;

	    Promise.is = function (val) {
	        return val instanceof Promise;
	    };

	    Promise.fromNode = Promise.fromCallback = function (fn) {
	        var ret = new Promise(INTERNAL);
	        ret._captureStackTrace();
	        var multiArgs = arguments.length > 1 ? !!Object(arguments[1]).multiArgs : false;
	        var result = tryCatch(fn)(nodebackForPromise(ret, multiArgs));
	        if (result === errorObj) {
	            ret._rejectCallback(result.e, true);
	        }
	        if (!ret._isFateSealed()) ret._setAsyncGuaranteed();
	        return ret;
	    };

	    Promise.all = function (promises) {
	        return new PromiseArray(promises).promise();
	    };

	    Promise.cast = function (obj) {
	        var ret = tryConvertToPromise(obj);
	        if (!(ret instanceof Promise)) {
	            ret = new Promise(INTERNAL);
	            ret._captureStackTrace();
	            ret._setFulfilled();
	            ret._rejectionHandler0 = obj;
	        }
	        return ret;
	    };

	    Promise.resolve = Promise.fulfilled = Promise.cast;

	    Promise.reject = Promise.rejected = function (reason) {
	        var ret = new Promise(INTERNAL);
	        ret._captureStackTrace();
	        ret._rejectCallback(reason, true);
	        return ret;
	    };

	    Promise.setScheduler = function (fn) {
	        if (typeof fn !== "function") {
	            throw new TypeError("expecting a function but got " + util.classString(fn));
	        }
	        return async.setScheduler(fn);
	    };

	    Promise.prototype._then = function (didFulfill, didReject, _, receiver, internalData) {
	        var haveInternalData = internalData !== undefined;
	        var promise = haveInternalData ? internalData : new Promise(INTERNAL);
	        var target = this._target();
	        var bitField = target._bitField;

	        if (!haveInternalData) {
	            promise._propagateFrom(this, 3);
	            promise._captureStackTrace();
	            if (receiver === undefined && (this._bitField & 2097152) !== 0) {
	                if (!((bitField & 50397184) === 0)) {
	                    receiver = this._boundValue();
	                } else {
	                    receiver = target === this ? undefined : this._boundTo;
	                }
	            }
	            this._fireEvent("promiseChained", this, promise);
	        }

	        var domain = getDomain();
	        if (!((bitField & 50397184) === 0)) {
	            var handler,
	                value,
	                settler = target._settlePromiseCtx;
	            if ((bitField & 33554432) !== 0) {
	                value = target._rejectionHandler0;
	                handler = didFulfill;
	            } else if ((bitField & 16777216) !== 0) {
	                value = target._fulfillmentHandler0;
	                handler = didReject;
	                target._unsetRejectionIsUnhandled();
	            } else {
	                settler = target._settlePromiseLateCancellationObserver;
	                value = new CancellationError("late cancellation observer");
	                target._attachExtraTrace(value);
	                handler = didReject;
	            }

	            async.invoke(settler, target, {
	                handler: domain === null ? handler : typeof handler === "function" && util.domainBind(domain, handler),
	                promise: promise,
	                receiver: receiver,
	                value: value
	            });
	        } else {
	            target._addCallbacks(didFulfill, didReject, promise, receiver, domain);
	        }

	        return promise;
	    };

	    Promise.prototype._length = function () {
	        return this._bitField & 65535;
	    };

	    Promise.prototype._isFateSealed = function () {
	        return (this._bitField & 117506048) !== 0;
	    };

	    Promise.prototype._isFollowing = function () {
	        return (this._bitField & 67108864) === 67108864;
	    };

	    Promise.prototype._setLength = function (len) {
	        this._bitField = this._bitField & -65536 | len & 65535;
	    };

	    Promise.prototype._setFulfilled = function () {
	        this._bitField = this._bitField | 33554432;
	        this._fireEvent("promiseFulfilled", this);
	    };

	    Promise.prototype._setRejected = function () {
	        this._bitField = this._bitField | 16777216;
	        this._fireEvent("promiseRejected", this);
	    };

	    Promise.prototype._setFollowing = function () {
	        this._bitField = this._bitField | 67108864;
	        this._fireEvent("promiseResolved", this);
	    };

	    Promise.prototype._setIsFinal = function () {
	        this._bitField = this._bitField | 4194304;
	    };

	    Promise.prototype._isFinal = function () {
	        return (this._bitField & 4194304) > 0;
	    };

	    Promise.prototype._unsetCancelled = function () {
	        this._bitField = this._bitField & ~65536;
	    };

	    Promise.prototype._setCancelled = function () {
	        this._bitField = this._bitField | 65536;
	        this._fireEvent("promiseCancelled", this);
	    };

	    Promise.prototype._setWillBeCancelled = function () {
	        this._bitField = this._bitField | 8388608;
	    };

	    Promise.prototype._setAsyncGuaranteed = function () {
	        if (async.hasCustomScheduler()) return;
	        this._bitField = this._bitField | 134217728;
	    };

	    Promise.prototype._receiverAt = function (index) {
	        var ret = index === 0 ? this._receiver0 : this[index * 4 - 4 + 3];
	        if (ret === UNDEFINED_BINDING) {
	            return undefined;
	        } else if (ret === undefined && this._isBound()) {
	            return this._boundValue();
	        }
	        return ret;
	    };

	    Promise.prototype._promiseAt = function (index) {
	        return this[index * 4 - 4 + 2];
	    };

	    Promise.prototype._fulfillmentHandlerAt = function (index) {
	        return this[index * 4 - 4 + 0];
	    };

	    Promise.prototype._rejectionHandlerAt = function (index) {
	        return this[index * 4 - 4 + 1];
	    };

	    Promise.prototype._boundValue = function () {};

	    Promise.prototype._migrateCallback0 = function (follower) {
	        var bitField = follower._bitField;
	        var fulfill = follower._fulfillmentHandler0;
	        var reject = follower._rejectionHandler0;
	        var promise = follower._promise0;
	        var receiver = follower._receiverAt(0);
	        if (receiver === undefined) receiver = UNDEFINED_BINDING;
	        this._addCallbacks(fulfill, reject, promise, receiver, null);
	    };

	    Promise.prototype._migrateCallbackAt = function (follower, index) {
	        var fulfill = follower._fulfillmentHandlerAt(index);
	        var reject = follower._rejectionHandlerAt(index);
	        var promise = follower._promiseAt(index);
	        var receiver = follower._receiverAt(index);
	        if (receiver === undefined) receiver = UNDEFINED_BINDING;
	        this._addCallbacks(fulfill, reject, promise, receiver, null);
	    };

	    Promise.prototype._addCallbacks = function (fulfill, reject, promise, receiver, domain) {
	        var index = this._length();

	        if (index >= 65535 - 4) {
	            index = 0;
	            this._setLength(0);
	        }

	        if (index === 0) {
	            this._promise0 = promise;
	            this._receiver0 = receiver;
	            if (typeof fulfill === "function") {
	                this._fulfillmentHandler0 = domain === null ? fulfill : util.domainBind(domain, fulfill);
	            }
	            if (typeof reject === "function") {
	                this._rejectionHandler0 = domain === null ? reject : util.domainBind(domain, reject);
	            }
	        } else {
	            var base = index * 4 - 4;
	            this[base + 2] = promise;
	            this[base + 3] = receiver;
	            if (typeof fulfill === "function") {
	                this[base + 0] = domain === null ? fulfill : util.domainBind(domain, fulfill);
	            }
	            if (typeof reject === "function") {
	                this[base + 1] = domain === null ? reject : util.domainBind(domain, reject);
	            }
	        }
	        this._setLength(index + 1);
	        return index;
	    };

	    Promise.prototype._proxy = function (proxyable, arg) {
	        this._addCallbacks(undefined, undefined, arg, proxyable, null);
	    };

	    Promise.prototype._resolveCallback = function (value, shouldBind) {
	        if ((this._bitField & 117506048) !== 0) return;
	        if (value === this) return this._rejectCallback(makeSelfResolutionError(), false);
	        var maybePromise = tryConvertToPromise(value, this);
	        if (!(maybePromise instanceof Promise)) return this._fulfill(value);

	        if (shouldBind) this._propagateFrom(maybePromise, 2);

	        var promise = maybePromise._target();

	        if (promise === this) {
	            this._reject(makeSelfResolutionError());
	            return;
	        }

	        var bitField = promise._bitField;
	        if ((bitField & 50397184) === 0) {
	            var len = this._length();
	            if (len > 0) promise._migrateCallback0(this);
	            for (var i = 1; i < len; ++i) {
	                promise._migrateCallbackAt(this, i);
	            }
	            this._setFollowing();
	            this._setLength(0);
	            this._setFollowee(promise);
	        } else if ((bitField & 33554432) !== 0) {
	            this._fulfill(promise._value());
	        } else if ((bitField & 16777216) !== 0) {
	            this._reject(promise._reason());
	        } else {
	            var reason = new CancellationError("late cancellation observer");
	            promise._attachExtraTrace(reason);
	            this._reject(reason);
	        }
	    };

	    Promise.prototype._rejectCallback = function (reason, synchronous, ignoreNonErrorWarnings) {
	        var trace = util.ensureErrorObject(reason);
	        var hasStack = trace === reason;
	        if (!hasStack && !ignoreNonErrorWarnings && debug.warnings()) {
	            var message = "a promise was rejected with a non-error: " + util.classString(reason);
	            this._warn(message, true);
	        }
	        this._attachExtraTrace(trace, synchronous ? hasStack : false);
	        this._reject(reason);
	    };

	    Promise.prototype._resolveFromExecutor = function (executor) {
	        var promise = this;
	        this._captureStackTrace();
	        this._pushContext();
	        var synchronous = true;
	        var r = this._execute(executor, function (value) {
	            promise._resolveCallback(value);
	        }, function (reason) {
	            promise._rejectCallback(reason, synchronous);
	        });
	        synchronous = false;
	        this._popContext();

	        if (r !== undefined) {
	            promise._rejectCallback(r, true);
	        }
	    };

	    Promise.prototype._settlePromiseFromHandler = function (handler, receiver, value, promise) {
	        var bitField = promise._bitField;
	        if ((bitField & 65536) !== 0) return;
	        promise._pushContext();
	        var x;
	        if (receiver === APPLY) {
	            if (!value || typeof value.length !== "number") {
	                x = errorObj;
	                x.e = new TypeError("cannot .spread() a non-array: " + util.classString(value));
	            } else {
	                x = tryCatch(handler).apply(this._boundValue(), value);
	            }
	        } else {
	            x = tryCatch(handler).call(receiver, value);
	        }
	        var promiseCreated = promise._popContext();
	        bitField = promise._bitField;
	        if ((bitField & 65536) !== 0) return;

	        if (x === NEXT_FILTER) {
	            promise._reject(value);
	        } else if (x === errorObj) {
	            promise._rejectCallback(x.e, false);
	        } else {
	            debug.checkForgottenReturns(x, promiseCreated, "", promise, this);
	            promise._resolveCallback(x);
	        }
	    };

	    Promise.prototype._target = function () {
	        var ret = this;
	        while (ret._isFollowing()) ret = ret._followee();
	        return ret;
	    };

	    Promise.prototype._followee = function () {
	        return this._rejectionHandler0;
	    };

	    Promise.prototype._setFollowee = function (promise) {
	        this._rejectionHandler0 = promise;
	    };

	    Promise.prototype._settlePromise = function (promise, handler, receiver, value) {
	        var isPromise = promise instanceof Promise;
	        var bitField = this._bitField;
	        var asyncGuaranteed = (bitField & 134217728) !== 0;
	        if ((bitField & 65536) !== 0) {
	            if (isPromise) promise._invokeInternalOnCancel();

	            if (receiver instanceof PassThroughHandlerContext && receiver.isFinallyHandler()) {
	                receiver.cancelPromise = promise;
	                if (tryCatch(handler).call(receiver, value) === errorObj) {
	                    promise._reject(errorObj.e);
	                }
	            } else if (handler === reflectHandler) {
	                promise._fulfill(reflectHandler.call(receiver));
	            } else if (receiver instanceof Proxyable) {
	                receiver._promiseCancelled(promise);
	            } else if (isPromise || promise instanceof PromiseArray) {
	                promise._cancel();
	            } else {
	                receiver.cancel();
	            }
	        } else if (typeof handler === "function") {
	            if (!isPromise) {
	                handler.call(receiver, value, promise);
	            } else {
	                if (asyncGuaranteed) promise._setAsyncGuaranteed();
	                this._settlePromiseFromHandler(handler, receiver, value, promise);
	            }
	        } else if (receiver instanceof Proxyable) {
	            if (!receiver._isResolved()) {
	                if ((bitField & 33554432) !== 0) {
	                    receiver._promiseFulfilled(value, promise);
	                } else {
	                    receiver._promiseRejected(value, promise);
	                }
	            }
	        } else if (isPromise) {
	            if (asyncGuaranteed) promise._setAsyncGuaranteed();
	            if ((bitField & 33554432) !== 0) {
	                promise._fulfill(value);
	            } else {
	                promise._reject(value);
	            }
	        }
	    };

	    Promise.prototype._settlePromiseLateCancellationObserver = function (ctx) {
	        var handler = ctx.handler;
	        var promise = ctx.promise;
	        var receiver = ctx.receiver;
	        var value = ctx.value;
	        if (typeof handler === "function") {
	            if (!(promise instanceof Promise)) {
	                handler.call(receiver, value, promise);
	            } else {
	                this._settlePromiseFromHandler(handler, receiver, value, promise);
	            }
	        } else if (promise instanceof Promise) {
	            promise._reject(value);
	        }
	    };

	    Promise.prototype._settlePromiseCtx = function (ctx) {
	        this._settlePromise(ctx.promise, ctx.handler, ctx.receiver, ctx.value);
	    };

	    Promise.prototype._settlePromise0 = function (handler, value, bitField) {
	        var promise = this._promise0;
	        var receiver = this._receiverAt(0);
	        this._promise0 = undefined;
	        this._receiver0 = undefined;
	        this._settlePromise(promise, handler, receiver, value);
	    };

	    Promise.prototype._clearCallbackDataAtIndex = function (index) {
	        var base = index * 4 - 4;
	        this[base + 2] = this[base + 3] = this[base + 0] = this[base + 1] = undefined;
	    };

	    Promise.prototype._fulfill = function (value) {
	        var bitField = this._bitField;
	        if ((bitField & 117506048) >>> 16) return;
	        if (value === this) {
	            var err = makeSelfResolutionError();
	            this._attachExtraTrace(err);
	            return this._reject(err);
	        }
	        this._setFulfilled();
	        this._rejectionHandler0 = value;

	        if ((bitField & 65535) > 0) {
	            if ((bitField & 134217728) !== 0) {
	                this._settlePromises();
	            } else {
	                async.settlePromises(this);
	            }
	        }
	    };

	    Promise.prototype._reject = function (reason) {
	        var bitField = this._bitField;
	        if ((bitField & 117506048) >>> 16) return;
	        this._setRejected();
	        this._fulfillmentHandler0 = reason;

	        if (this._isFinal()) {
	            return async.fatalError(reason, util.isNode);
	        }

	        if ((bitField & 65535) > 0) {
	            async.settlePromises(this);
	        } else {
	            this._ensurePossibleRejectionHandled();
	        }
	    };

	    Promise.prototype._fulfillPromises = function (len, value) {
	        for (var i = 1; i < len; i++) {
	            var handler = this._fulfillmentHandlerAt(i);
	            var promise = this._promiseAt(i);
	            var receiver = this._receiverAt(i);
	            this._clearCallbackDataAtIndex(i);
	            this._settlePromise(promise, handler, receiver, value);
	        }
	    };

	    Promise.prototype._rejectPromises = function (len, reason) {
	        for (var i = 1; i < len; i++) {
	            var handler = this._rejectionHandlerAt(i);
	            var promise = this._promiseAt(i);
	            var receiver = this._receiverAt(i);
	            this._clearCallbackDataAtIndex(i);
	            this._settlePromise(promise, handler, receiver, reason);
	        }
	    };

	    Promise.prototype._settlePromises = function () {
	        var bitField = this._bitField;
	        var len = bitField & 65535;

	        if (len > 0) {
	            if ((bitField & 16842752) !== 0) {
	                var reason = this._fulfillmentHandler0;
	                this._settlePromise0(this._rejectionHandler0, reason, bitField);
	                this._rejectPromises(len, reason);
	            } else {
	                var value = this._rejectionHandler0;
	                this._settlePromise0(this._fulfillmentHandler0, value, bitField);
	                this._fulfillPromises(len, value);
	            }
	            this._setLength(0);
	        }
	        this._clearCancellationData();
	    };

	    Promise.prototype._settledValue = function () {
	        var bitField = this._bitField;
	        if ((bitField & 33554432) !== 0) {
	            return this._rejectionHandler0;
	        } else if ((bitField & 16777216) !== 0) {
	            return this._fulfillmentHandler0;
	        }
	    };

	    function deferResolve(v) {
	        this.promise._resolveCallback(v);
	    }
	    function deferReject(v) {
	        this.promise._rejectCallback(v, false);
	    }

	    Promise.defer = Promise.pending = function () {
	        debug.deprecated("Promise.defer", "new Promise");
	        var promise = new Promise(INTERNAL);
	        return {
	            promise: promise,
	            resolve: deferResolve,
	            reject: deferReject
	        };
	    };

	    util.notEnumerableProp(Promise, "_makeSelfResolutionError", makeSelfResolutionError);

	    __webpack_require__(25)(Promise, INTERNAL, tryConvertToPromise, apiRejection, debug);
	    __webpack_require__(26)(Promise, INTERNAL, tryConvertToPromise, debug);
	    __webpack_require__(27)(Promise, PromiseArray, apiRejection, debug);
	    __webpack_require__(28)(Promise);
	    __webpack_require__(29)(Promise);
	    __webpack_require__(30)(Promise, PromiseArray, tryConvertToPromise, INTERNAL, async, getDomain);
	    Promise.Promise = Promise;
	    Promise.version = "3.4.6";
	    __webpack_require__(31)(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
	    __webpack_require__(32)(Promise);
	    __webpack_require__(33)(Promise, apiRejection, tryConvertToPromise, createContext, INTERNAL, debug);
	    __webpack_require__(34)(Promise, INTERNAL, debug);
	    __webpack_require__(35)(Promise, apiRejection, INTERNAL, tryConvertToPromise, Proxyable, debug);
	    __webpack_require__(36)(Promise);
	    __webpack_require__(37)(Promise, INTERNAL);
	    __webpack_require__(38)(Promise, PromiseArray, tryConvertToPromise, apiRejection);
	    __webpack_require__(39)(Promise, INTERNAL, tryConvertToPromise, apiRejection);
	    __webpack_require__(40)(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
	    __webpack_require__(41)(Promise, PromiseArray, debug);
	    __webpack_require__(42)(Promise, PromiseArray, apiRejection);
	    __webpack_require__(43)(Promise, INTERNAL);
	    __webpack_require__(44)(Promise, INTERNAL);
	    __webpack_require__(45)(Promise);

	    util.toFastProperties(Promise);
	    util.toFastProperties(Promise.prototype);
	    function fillTypes(value) {
	        var p = new Promise(INTERNAL);
	        p._fulfillmentHandler0 = value;
	        p._rejectionHandler0 = value;
	        p._promise0 = value;
	        p._receiver0 = value;
	    }
	    // Complete slack tracking, opt out of field-type tracking and           
	    // stabilize map                                                         
	    fillTypes({ a: 1 });
	    fillTypes({ b: 2 });
	    fillTypes({ c: 3 });
	    fillTypes(1);
	    fillTypes(function () {});
	    fillTypes(undefined);
	    fillTypes(false);
	    fillTypes(new Promise(INTERNAL));
	    debug.setBounds(Async.firstLineError, util.lastLineError);
	    return Promise;
	};

/***/ },
/* 12 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var es5 = __webpack_require__(13);
	var canEvaluate = typeof navigator == "undefined";

	var errorObj = { e: {} };
	var tryCatchTarget;
	var globalObject = typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this !== undefined ? this : null;

	function tryCatcher() {
	    try {
	        var target = tryCatchTarget;
	        tryCatchTarget = null;
	        return target.apply(this, arguments);
	    } catch (e) {
	        errorObj.e = e;
	        return errorObj;
	    }
	}
	function tryCatch(fn) {
	    tryCatchTarget = fn;
	    return tryCatcher;
	}

	var inherits = function (Child, Parent) {
	    var hasProp = {}.hasOwnProperty;

	    function T() {
	        this.constructor = Child;
	        this.constructor$ = Parent;
	        for (var propertyName in Parent.prototype) {
	            if (hasProp.call(Parent.prototype, propertyName) && propertyName.charAt(propertyName.length - 1) !== "$") {
	                this[propertyName + "$"] = Parent.prototype[propertyName];
	            }
	        }
	    }
	    T.prototype = Parent.prototype;
	    Child.prototype = new T();
	    return Child.prototype;
	};

	function isPrimitive(val) {
	    return val == null || val === true || val === false || typeof val === "string" || typeof val === "number";
	}

	function isObject(value) {
	    return typeof value === "function" || typeof value === "object" && value !== null;
	}

	function maybeWrapAsError(maybeError) {
	    if (!isPrimitive(maybeError)) return maybeError;

	    return new Error(safeToString(maybeError));
	}

	function withAppended(target, appendee) {
	    var len = target.length;
	    var ret = new Array(len + 1);
	    var i;
	    for (i = 0; i < len; ++i) {
	        ret[i] = target[i];
	    }
	    ret[i] = appendee;
	    return ret;
	}

	function getDataPropertyOrDefault(obj, key, defaultValue) {
	    if (es5.isES5) {
	        var desc = Object.getOwnPropertyDescriptor(obj, key);

	        if (desc != null) {
	            return desc.get == null && desc.set == null ? desc.value : defaultValue;
	        }
	    } else {
	        return {}.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
	    }
	}

	function notEnumerableProp(obj, name, value) {
	    if (isPrimitive(obj)) return obj;
	    var descriptor = {
	        value: value,
	        configurable: true,
	        enumerable: false,
	        writable: true
	    };
	    es5.defineProperty(obj, name, descriptor);
	    return obj;
	}

	function thrower(r) {
	    throw r;
	}

	var inheritedDataKeys = function () {
	    var excludedPrototypes = [Array.prototype, Object.prototype, Function.prototype];

	    var isExcludedProto = function (val) {
	        for (var i = 0; i < excludedPrototypes.length; ++i) {
	            if (excludedPrototypes[i] === val) {
	                return true;
	            }
	        }
	        return false;
	    };

	    if (es5.isES5) {
	        var getKeys = Object.getOwnPropertyNames;
	        return function (obj) {
	            var ret = [];
	            var visitedKeys = Object.create(null);
	            while (obj != null && !isExcludedProto(obj)) {
	                var keys;
	                try {
	                    keys = getKeys(obj);
	                } catch (e) {
	                    return ret;
	                }
	                for (var i = 0; i < keys.length; ++i) {
	                    var key = keys[i];
	                    if (visitedKeys[key]) continue;
	                    visitedKeys[key] = true;
	                    var desc = Object.getOwnPropertyDescriptor(obj, key);
	                    if (desc != null && desc.get == null && desc.set == null) {
	                        ret.push(key);
	                    }
	                }
	                obj = es5.getPrototypeOf(obj);
	            }
	            return ret;
	        };
	    } else {
	        var hasProp = {}.hasOwnProperty;
	        return function (obj) {
	            if (isExcludedProto(obj)) return [];
	            var ret = [];

	            /*jshint forin:false */
	            enumeration: for (var key in obj) {
	                if (hasProp.call(obj, key)) {
	                    ret.push(key);
	                } else {
	                    for (var i = 0; i < excludedPrototypes.length; ++i) {
	                        if (hasProp.call(excludedPrototypes[i], key)) {
	                            continue enumeration;
	                        }
	                    }
	                    ret.push(key);
	                }
	            }
	            return ret;
	        };
	    }
	}();

	var thisAssignmentPattern = /this\s*\.\s*\S+\s*=/;
	function isClass(fn) {
	    try {
	        if (typeof fn === "function") {
	            var keys = es5.names(fn.prototype);

	            var hasMethods = es5.isES5 && keys.length > 1;
	            var hasMethodsOtherThanConstructor = keys.length > 0 && !(keys.length === 1 && keys[0] === "constructor");
	            var hasThisAssignmentAndStaticMethods = thisAssignmentPattern.test(fn + "") && es5.names(fn).length > 0;

	            if (hasMethods || hasMethodsOtherThanConstructor || hasThisAssignmentAndStaticMethods) {
	                return true;
	            }
	        }
	        return false;
	    } catch (e) {
	        return false;
	    }
	}

	function toFastProperties(obj) {
	    /*jshint -W027,-W055,-W031*/
	    function FakeConstructor() {}
	    FakeConstructor.prototype = obj;
	    var l = 8;
	    while (l--) new FakeConstructor();
	    return obj;
	    eval(obj);
	}

	var rident = /^[a-z$_][a-z$_0-9]*$/i;
	function isIdentifier(str) {
	    return rident.test(str);
	}

	function filledRange(count, prefix, suffix) {
	    var ret = new Array(count);
	    for (var i = 0; i < count; ++i) {
	        ret[i] = prefix + i + suffix;
	    }
	    return ret;
	}

	function safeToString(obj) {
	    try {
	        return obj + "";
	    } catch (e) {
	        return "[no string representation]";
	    }
	}

	function isError(obj) {
	    return obj !== null && typeof obj === "object" && typeof obj.message === "string" && typeof obj.name === "string";
	}

	function markAsOriginatingFromRejection(e) {
	    try {
	        notEnumerableProp(e, "isOperational", true);
	    } catch (ignore) {}
	}

	function originatesFromRejection(e) {
	    if (e == null) return false;
	    return e instanceof Error["__BluebirdErrorTypes__"].OperationalError || e["isOperational"] === true;
	}

	function canAttachTrace(obj) {
	    return isError(obj) && es5.propertyIsWritable(obj, "stack");
	}

	var ensureErrorObject = function () {
	    if (!("stack" in new Error())) {
	        return function (value) {
	            if (canAttachTrace(value)) return value;
	            try {
	                throw new Error(safeToString(value));
	            } catch (err) {
	                return err;
	            }
	        };
	    } else {
	        return function (value) {
	            if (canAttachTrace(value)) return value;
	            return new Error(safeToString(value));
	        };
	    }
	}();

	function classString(obj) {
	    return {}.toString.call(obj);
	}

	function copyDescriptors(from, to, filter) {
	    var keys = es5.names(from);
	    for (var i = 0; i < keys.length; ++i) {
	        var key = keys[i];
	        if (filter(key)) {
	            try {
	                es5.defineProperty(to, key, es5.getDescriptor(from, key));
	            } catch (ignore) {}
	        }
	    }
	}

	var asArray = function (v) {
	    if (es5.isArray(v)) {
	        return v;
	    }
	    return null;
	};

	if (typeof Symbol !== "undefined" && Symbol.iterator) {
	    var ArrayFrom = typeof Array.from === "function" ? function (v) {
	        return Array.from(v);
	    } : function (v) {
	        var ret = [];
	        var it = v[Symbol.iterator]();
	        var itResult;
	        while (!(itResult = it.next()).done) {
	            ret.push(itResult.value);
	        }
	        return ret;
	    };

	    asArray = function (v) {
	        if (es5.isArray(v)) {
	            return v;
	        } else if (v != null && typeof v[Symbol.iterator] === "function") {
	            return ArrayFrom(v);
	        }
	        return null;
	    };
	}

	var isNode = typeof process !== "undefined" && classString(process).toLowerCase() === "[object process]";

	function env(key, def) {
	    return isNode ? process.env[key] : def;
	}

	function getNativePromise() {
	    if (typeof Promise === "function") {
	        try {
	            var promise = new Promise(function () {});
	            if ({}.toString.call(promise) === "[object Promise]") {
	                return Promise;
	            }
	        } catch (e) {}
	    }
	}

	function domainBind(self, cb) {
	    return self.bind(cb);
	}

	var ret = {
	    isClass: isClass,
	    isIdentifier: isIdentifier,
	    inheritedDataKeys: inheritedDataKeys,
	    getDataPropertyOrDefault: getDataPropertyOrDefault,
	    thrower: thrower,
	    isArray: es5.isArray,
	    asArray: asArray,
	    notEnumerableProp: notEnumerableProp,
	    isPrimitive: isPrimitive,
	    isObject: isObject,
	    isError: isError,
	    canEvaluate: canEvaluate,
	    errorObj: errorObj,
	    tryCatch: tryCatch,
	    inherits: inherits,
	    withAppended: withAppended,
	    maybeWrapAsError: maybeWrapAsError,
	    toFastProperties: toFastProperties,
	    filledRange: filledRange,
	    toString: safeToString,
	    canAttachTrace: canAttachTrace,
	    ensureErrorObject: ensureErrorObject,
	    originatesFromRejection: originatesFromRejection,
	    markAsOriginatingFromRejection: markAsOriginatingFromRejection,
	    classString: classString,
	    copyDescriptors: copyDescriptors,
	    hasDevTools: typeof chrome !== "undefined" && chrome && typeof chrome.loadTimes === "function",
	    isNode: isNode,
	    env: env,
	    global: globalObject,
	    getNativePromise: getNativePromise,
	    domainBind: domainBind
	};
	ret.isRecentNode = ret.isNode && function () {
	    var version = process.versions.node.split(".").map(Number);
	    return version[0] === 0 && version[1] > 10 || version[0] > 0;
	}();

	if (ret.isNode) ret.toFastProperties(process);

	try {
	    throw new Error();
	} catch (e) {
	    ret.lastLineError = e;
	}
	module.exports = ret;

/***/ },
/* 13 */
/***/ function(module, exports) {

	var isES5 = function () {
	    "use strict";

	    return this === undefined;
	}();

	if (isES5) {
	    module.exports = {
	        freeze: Object.freeze,
	        defineProperty: Object.defineProperty,
	        getDescriptor: Object.getOwnPropertyDescriptor,
	        keys: Object.keys,
	        names: Object.getOwnPropertyNames,
	        getPrototypeOf: Object.getPrototypeOf,
	        isArray: Array.isArray,
	        isES5: isES5,
	        propertyIsWritable: function (obj, prop) {
	            var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
	            return !!(!descriptor || descriptor.writable || descriptor.set);
	        }
	    };
	} else {
	    var has = {}.hasOwnProperty;
	    var str = {}.toString;
	    var proto = {}.constructor.prototype;

	    var ObjectKeys = function (o) {
	        var ret = [];
	        for (var key in o) {
	            if (has.call(o, key)) {
	                ret.push(key);
	            }
	        }
	        return ret;
	    };

	    var ObjectGetDescriptor = function (o, key) {
	        return { value: o[key] };
	    };

	    var ObjectDefineProperty = function (o, key, desc) {
	        o[key] = desc.value;
	        return o;
	    };

	    var ObjectFreeze = function (obj) {
	        return obj;
	    };

	    var ObjectGetPrototypeOf = function (obj) {
	        try {
	            return Object(obj).constructor.prototype;
	        } catch (e) {
	            return proto;
	        }
	    };

	    var ArrayIsArray = function (obj) {
	        try {
	            return str.call(obj) === "[object Array]";
	        } catch (e) {
	            return false;
	        }
	    };

	    module.exports = {
	        isArray: ArrayIsArray,
	        keys: ObjectKeys,
	        names: ObjectKeys,
	        defineProperty: ObjectDefineProperty,
	        getDescriptor: ObjectGetDescriptor,
	        freeze: ObjectFreeze,
	        getPrototypeOf: ObjectGetPrototypeOf,
	        isES5: isES5,
	        propertyIsWritable: function () {
	            return true;
	        }
	    };
	}

/***/ },
/* 14 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var firstLineError;
	try {
	    throw new Error();
	} catch (e) {
	    firstLineError = e;
	}
	var schedule = __webpack_require__(15);
	var Queue = __webpack_require__(16);
	var util = __webpack_require__(12);

	function Async() {
	    this._customScheduler = false;
	    this._isTickUsed = false;
	    this._lateQueue = new Queue(16);
	    this._normalQueue = new Queue(16);
	    this._haveDrainedQueues = false;
	    this._trampolineEnabled = true;
	    var self = this;
	    this.drainQueues = function () {
	        self._drainQueues();
	    };
	    this._schedule = schedule;
	}

	Async.prototype.setScheduler = function (fn) {
	    var prev = this._schedule;
	    this._schedule = fn;
	    this._customScheduler = true;
	    return prev;
	};

	Async.prototype.hasCustomScheduler = function () {
	    return this._customScheduler;
	};

	Async.prototype.enableTrampoline = function () {
	    this._trampolineEnabled = true;
	};

	Async.prototype.disableTrampolineIfNecessary = function () {
	    if (util.hasDevTools) {
	        this._trampolineEnabled = false;
	    }
	};

	Async.prototype.haveItemsQueued = function () {
	    return this._isTickUsed || this._haveDrainedQueues;
	};

	Async.prototype.fatalError = function (e, isNode) {
	    if (isNode) {
	        process.stderr.write("Fatal " + (e instanceof Error ? e.stack : e) + "\n");
	        process.exit(2);
	    } else {
	        this.throwLater(e);
	    }
	};

	Async.prototype.throwLater = function (fn, arg) {
	    if (arguments.length === 1) {
	        arg = fn;
	        fn = function () {
	            throw arg;
	        };
	    }
	    if (typeof setTimeout !== "undefined") {
	        setTimeout(function () {
	            fn(arg);
	        }, 0);
	    } else try {
	        this._schedule(function () {
	            fn(arg);
	        });
	    } catch (e) {
	        throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	    }
	};

	function AsyncInvokeLater(fn, receiver, arg) {
	    this._lateQueue.push(fn, receiver, arg);
	    this._queueTick();
	}

	function AsyncInvoke(fn, receiver, arg) {
	    this._normalQueue.push(fn, receiver, arg);
	    this._queueTick();
	}

	function AsyncSettlePromises(promise) {
	    this._normalQueue._pushOne(promise);
	    this._queueTick();
	}

	if (!util.hasDevTools) {
	    Async.prototype.invokeLater = AsyncInvokeLater;
	    Async.prototype.invoke = AsyncInvoke;
	    Async.prototype.settlePromises = AsyncSettlePromises;
	} else {
	    Async.prototype.invokeLater = function (fn, receiver, arg) {
	        if (this._trampolineEnabled) {
	            AsyncInvokeLater.call(this, fn, receiver, arg);
	        } else {
	            this._schedule(function () {
	                setTimeout(function () {
	                    fn.call(receiver, arg);
	                }, 100);
	            });
	        }
	    };

	    Async.prototype.invoke = function (fn, receiver, arg) {
	        if (this._trampolineEnabled) {
	            AsyncInvoke.call(this, fn, receiver, arg);
	        } else {
	            this._schedule(function () {
	                fn.call(receiver, arg);
	            });
	        }
	    };

	    Async.prototype.settlePromises = function (promise) {
	        if (this._trampolineEnabled) {
	            AsyncSettlePromises.call(this, promise);
	        } else {
	            this._schedule(function () {
	                promise._settlePromises();
	            });
	        }
	    };
	}

	Async.prototype.invokeFirst = function (fn, receiver, arg) {
	    this._normalQueue.unshift(fn, receiver, arg);
	    this._queueTick();
	};

	Async.prototype._drainQueue = function (queue) {
	    while (queue.length() > 0) {
	        var fn = queue.shift();
	        if (typeof fn !== "function") {
	            fn._settlePromises();
	            continue;
	        }
	        var receiver = queue.shift();
	        var arg = queue.shift();
	        fn.call(receiver, arg);
	    }
	};

	Async.prototype._drainQueues = function () {
	    this._drainQueue(this._normalQueue);
	    this._reset();
	    this._haveDrainedQueues = true;
	    this._drainQueue(this._lateQueue);
	};

	Async.prototype._queueTick = function () {
	    if (!this._isTickUsed) {
	        this._isTickUsed = true;
	        this._schedule(this.drainQueues);
	    }
	};

	Async.prototype._reset = function () {
	    this._isTickUsed = false;
	};

	module.exports = Async;
	module.exports.firstLineError = firstLineError;

/***/ },
/* 15 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var util = __webpack_require__(12);
	var schedule;
	var noAsyncScheduler = function () {
	    throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	};
	var NativePromise = util.getNativePromise();
	if (util.isNode && typeof MutationObserver === "undefined") {
	    var GlobalSetImmediate = global.setImmediate;
	    var ProcessNextTick = process.nextTick;
	    schedule = util.isRecentNode ? function (fn) {
	        GlobalSetImmediate.call(global, fn);
	    } : function (fn) {
	        ProcessNextTick.call(process, fn);
	    };
	} else if (typeof NativePromise === "function" && typeof NativePromise.resolve === "function") {
	    var nativePromise = NativePromise.resolve();
	    schedule = function (fn) {
	        nativePromise.then(fn);
	    };
	} else if (typeof MutationObserver !== "undefined" && !(typeof window !== "undefined" && window.navigator && (window.navigator.standalone || window.cordova))) {
	    schedule = function () {
	        var div = document.createElement("div");
	        var opts = { attributes: true };
	        var toggleScheduled = false;
	        var div2 = document.createElement("div");
	        var o2 = new MutationObserver(function () {
	            div.classList.toggle("foo");
	            toggleScheduled = false;
	        });
	        o2.observe(div2, opts);

	        var scheduleToggle = function () {
	            if (toggleScheduled) return;
	            toggleScheduled = true;
	            div2.classList.toggle("foo");
	        };

	        return function schedule(fn) {
	            var o = new MutationObserver(function () {
	                o.disconnect();
	                fn();
	            });
	            o.observe(div, opts);
	            scheduleToggle();
	        };
	    }();
	} else if (typeof setImmediate !== "undefined") {
	    schedule = function (fn) {
	        setImmediate(fn);
	    };
	} else if (typeof setTimeout !== "undefined") {
	    schedule = function (fn) {
	        setTimeout(fn, 0);
	    };
	} else {
	    schedule = noAsyncScheduler;
	}
	module.exports = schedule;

/***/ },
/* 16 */
/***/ function(module, exports) {

	"use strict";

	function arrayMove(src, srcIndex, dst, dstIndex, len) {
	    for (var j = 0; j < len; ++j) {
	        dst[j + dstIndex] = src[j + srcIndex];
	        src[j + srcIndex] = void 0;
	    }
	}

	function Queue(capacity) {
	    this._capacity = capacity;
	    this._length = 0;
	    this._front = 0;
	}

	Queue.prototype._willBeOverCapacity = function (size) {
	    return this._capacity < size;
	};

	Queue.prototype._pushOne = function (arg) {
	    var length = this.length();
	    this._checkCapacity(length + 1);
	    var i = this._front + length & this._capacity - 1;
	    this[i] = arg;
	    this._length = length + 1;
	};

	Queue.prototype._unshiftOne = function (value) {
	    var capacity = this._capacity;
	    this._checkCapacity(this.length() + 1);
	    var front = this._front;
	    var i = (front - 1 & capacity - 1 ^ capacity) - capacity;
	    this[i] = value;
	    this._front = i;
	    this._length = this.length() + 1;
	};

	Queue.prototype.unshift = function (fn, receiver, arg) {
	    this._unshiftOne(arg);
	    this._unshiftOne(receiver);
	    this._unshiftOne(fn);
	};

	Queue.prototype.push = function (fn, receiver, arg) {
	    var length = this.length() + 3;
	    if (this._willBeOverCapacity(length)) {
	        this._pushOne(fn);
	        this._pushOne(receiver);
	        this._pushOne(arg);
	        return;
	    }
	    var j = this._front + length - 3;
	    this._checkCapacity(length);
	    var wrapMask = this._capacity - 1;
	    this[j + 0 & wrapMask] = fn;
	    this[j + 1 & wrapMask] = receiver;
	    this[j + 2 & wrapMask] = arg;
	    this._length = length;
	};

	Queue.prototype.shift = function () {
	    var front = this._front,
	        ret = this[front];

	    this[front] = undefined;
	    this._front = front + 1 & this._capacity - 1;
	    this._length--;
	    return ret;
	};

	Queue.prototype.length = function () {
	    return this._length;
	};

	Queue.prototype._checkCapacity = function (size) {
	    if (this._capacity < size) {
	        this._resizeTo(this._capacity << 1);
	    }
	};

	Queue.prototype._resizeTo = function (capacity) {
	    var oldCapacity = this._capacity;
	    this._capacity = capacity;
	    var front = this._front;
	    var length = this._length;
	    var moveItemsCount = front + length & oldCapacity - 1;
	    arrayMove(this, 0, this, oldCapacity, moveItemsCount);
	};

	module.exports = Queue;

/***/ },
/* 17 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var es5 = __webpack_require__(13);
	var Objectfreeze = es5.freeze;
	var util = __webpack_require__(12);
	var inherits = util.inherits;
	var notEnumerableProp = util.notEnumerableProp;

	function subError(nameProperty, defaultMessage) {
	    function SubError(message) {
	        if (!(this instanceof SubError)) return new SubError(message);
	        notEnumerableProp(this, "message", typeof message === "string" ? message : defaultMessage);
	        notEnumerableProp(this, "name", nameProperty);
	        if (Error.captureStackTrace) {
	            Error.captureStackTrace(this, this.constructor);
	        } else {
	            Error.call(this);
	        }
	    }
	    inherits(SubError, Error);
	    return SubError;
	}

	var _TypeError, _RangeError;
	var Warning = subError("Warning", "warning");
	var CancellationError = subError("CancellationError", "cancellation error");
	var TimeoutError = subError("TimeoutError", "timeout error");
	var AggregateError = subError("AggregateError", "aggregate error");
	try {
	    _TypeError = TypeError;
	    _RangeError = RangeError;
	} catch (e) {
	    _TypeError = subError("TypeError", "type error");
	    _RangeError = subError("RangeError", "range error");
	}

	var methods = ("join pop push shift unshift slice filter forEach some " + "every map indexOf lastIndexOf reduce reduceRight sort reverse").split(" ");

	for (var i = 0; i < methods.length; ++i) {
	    if (typeof Array.prototype[methods[i]] === "function") {
	        AggregateError.prototype[methods[i]] = Array.prototype[methods[i]];
	    }
	}

	es5.defineProperty(AggregateError.prototype, "length", {
	    value: 0,
	    configurable: false,
	    writable: true,
	    enumerable: true
	});
	AggregateError.prototype["isOperational"] = true;
	var level = 0;
	AggregateError.prototype.toString = function () {
	    var indent = Array(level * 4 + 1).join(" ");
	    var ret = "\n" + indent + "AggregateError of:" + "\n";
	    level++;
	    indent = Array(level * 4 + 1).join(" ");
	    for (var i = 0; i < this.length; ++i) {
	        var str = this[i] === this ? "[Circular AggregateError]" : this[i] + "";
	        var lines = str.split("\n");
	        for (var j = 0; j < lines.length; ++j) {
	            lines[j] = indent + lines[j];
	        }
	        str = lines.join("\n");
	        ret += str + "\n";
	    }
	    level--;
	    return ret;
	};

	function OperationalError(message) {
	    if (!(this instanceof OperationalError)) return new OperationalError(message);
	    notEnumerableProp(this, "name", "OperationalError");
	    notEnumerableProp(this, "message", message);
	    this.cause = message;
	    this["isOperational"] = true;

	    if (message instanceof Error) {
	        notEnumerableProp(this, "message", message.message);
	        notEnumerableProp(this, "stack", message.stack);
	    } else if (Error.captureStackTrace) {
	        Error.captureStackTrace(this, this.constructor);
	    }
	}
	inherits(OperationalError, Error);

	var errorTypes = Error["__BluebirdErrorTypes__"];
	if (!errorTypes) {
	    errorTypes = Objectfreeze({
	        CancellationError: CancellationError,
	        TimeoutError: TimeoutError,
	        OperationalError: OperationalError,
	        RejectionError: OperationalError,
	        AggregateError: AggregateError
	    });
	    es5.defineProperty(Error, "__BluebirdErrorTypes__", {
	        value: errorTypes,
	        writable: false,
	        enumerable: false,
	        configurable: false
	    });
	}

	module.exports = {
	    Error: Error,
	    TypeError: _TypeError,
	    RangeError: _RangeError,
	    CancellationError: errorTypes.CancellationError,
	    OperationalError: errorTypes.OperationalError,
	    TimeoutError: errorTypes.TimeoutError,
	    AggregateError: errorTypes.AggregateError,
	    Warning: Warning
	};

/***/ },
/* 18 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, INTERNAL) {
	    var util = __webpack_require__(12);
	    var errorObj = util.errorObj;
	    var isObject = util.isObject;

	    function tryConvertToPromise(obj, context) {
	        if (isObject(obj)) {
	            if (obj instanceof Promise) return obj;
	            var then = getThen(obj);
	            if (then === errorObj) {
	                if (context) context._pushContext();
	                var ret = Promise.reject(then.e);
	                if (context) context._popContext();
	                return ret;
	            } else if (typeof then === "function") {
	                if (isAnyBluebirdPromise(obj)) {
	                    var ret = new Promise(INTERNAL);
	                    obj._then(ret._fulfill, ret._reject, undefined, ret, null);
	                    return ret;
	                }
	                return doThenable(obj, then, context);
	            }
	        }
	        return obj;
	    }

	    function doGetThen(obj) {
	        return obj.then;
	    }

	    function getThen(obj) {
	        try {
	            return doGetThen(obj);
	        } catch (e) {
	            errorObj.e = e;
	            return errorObj;
	        }
	    }

	    var hasProp = {}.hasOwnProperty;
	    function isAnyBluebirdPromise(obj) {
	        try {
	            return hasProp.call(obj, "_promise0");
	        } catch (e) {
	            return false;
	        }
	    }

	    function doThenable(x, then, context) {
	        var promise = new Promise(INTERNAL);
	        var ret = promise;
	        if (context) context._pushContext();
	        promise._captureStackTrace();
	        if (context) context._popContext();
	        var synchronous = true;
	        var result = util.tryCatch(then).call(x, resolve, reject);
	        synchronous = false;

	        if (promise && result === errorObj) {
	            promise._rejectCallback(result.e, true, true);
	            promise = null;
	        }

	        function resolve(value) {
	            if (!promise) return;
	            promise._resolveCallback(value);
	            promise = null;
	        }

	        function reject(reason) {
	            if (!promise) return;
	            promise._rejectCallback(reason, synchronous, true);
	            promise = null;
	        }
	        return ret;
	    }

	    return tryConvertToPromise;
	};

/***/ },
/* 19 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, INTERNAL, tryConvertToPromise, apiRejection, Proxyable) {
	    var util = __webpack_require__(12);
	    var isArray = util.isArray;

	    function toResolutionValue(val) {
	        switch (val) {
	            case -2:
	                return [];
	            case -3:
	                return {};
	        }
	    }

	    function PromiseArray(values) {
	        var promise = this._promise = new Promise(INTERNAL);
	        if (values instanceof Promise) {
	            promise._propagateFrom(values, 3);
	        }
	        promise._setOnCancel(this);
	        this._values = values;
	        this._length = 0;
	        this._totalResolved = 0;
	        this._init(undefined, -2);
	    }
	    util.inherits(PromiseArray, Proxyable);

	    PromiseArray.prototype.length = function () {
	        return this._length;
	    };

	    PromiseArray.prototype.promise = function () {
	        return this._promise;
	    };

	    PromiseArray.prototype._init = function init(_, resolveValueIfEmpty) {
	        var values = tryConvertToPromise(this._values, this._promise);
	        if (values instanceof Promise) {
	            values = values._target();
	            var bitField = values._bitField;
	            ;
	            this._values = values;

	            if ((bitField & 50397184) === 0) {
	                this._promise._setAsyncGuaranteed();
	                return values._then(init, this._reject, undefined, this, resolveValueIfEmpty);
	            } else if ((bitField & 33554432) !== 0) {
	                values = values._value();
	            } else if ((bitField & 16777216) !== 0) {
	                return this._reject(values._reason());
	            } else {
	                return this._cancel();
	            }
	        }
	        values = util.asArray(values);
	        if (values === null) {
	            var err = apiRejection("expecting an array or an iterable object but got " + util.classString(values)).reason();
	            this._promise._rejectCallback(err, false);
	            return;
	        }

	        if (values.length === 0) {
	            if (resolveValueIfEmpty === -5) {
	                this._resolveEmptyArray();
	            } else {
	                this._resolve(toResolutionValue(resolveValueIfEmpty));
	            }
	            return;
	        }
	        this._iterate(values);
	    };

	    PromiseArray.prototype._iterate = function (values) {
	        var len = this.getActualLength(values.length);
	        this._length = len;
	        this._values = this.shouldCopyValues() ? new Array(len) : this._values;
	        var result = this._promise;
	        var isResolved = false;
	        var bitField = null;
	        for (var i = 0; i < len; ++i) {
	            var maybePromise = tryConvertToPromise(values[i], result);

	            if (maybePromise instanceof Promise) {
	                maybePromise = maybePromise._target();
	                bitField = maybePromise._bitField;
	            } else {
	                bitField = null;
	            }

	            if (isResolved) {
	                if (bitField !== null) {
	                    maybePromise.suppressUnhandledRejections();
	                }
	            } else if (bitField !== null) {
	                if ((bitField & 50397184) === 0) {
	                    maybePromise._proxy(this, i);
	                    this._values[i] = maybePromise;
	                } else if ((bitField & 33554432) !== 0) {
	                    isResolved = this._promiseFulfilled(maybePromise._value(), i);
	                } else if ((bitField & 16777216) !== 0) {
	                    isResolved = this._promiseRejected(maybePromise._reason(), i);
	                } else {
	                    isResolved = this._promiseCancelled(i);
	                }
	            } else {
	                isResolved = this._promiseFulfilled(maybePromise, i);
	            }
	        }
	        if (!isResolved) result._setAsyncGuaranteed();
	    };

	    PromiseArray.prototype._isResolved = function () {
	        return this._values === null;
	    };

	    PromiseArray.prototype._resolve = function (value) {
	        this._values = null;
	        this._promise._fulfill(value);
	    };

	    PromiseArray.prototype._cancel = function () {
	        if (this._isResolved() || !this._promise._isCancellable()) return;
	        this._values = null;
	        this._promise._cancel();
	    };

	    PromiseArray.prototype._reject = function (reason) {
	        this._values = null;
	        this._promise._rejectCallback(reason, false);
	    };

	    PromiseArray.prototype._promiseFulfilled = function (value, index) {
	        this._values[index] = value;
	        var totalResolved = ++this._totalResolved;
	        if (totalResolved >= this._length) {
	            this._resolve(this._values);
	            return true;
	        }
	        return false;
	    };

	    PromiseArray.prototype._promiseCancelled = function () {
	        this._cancel();
	        return true;
	    };

	    PromiseArray.prototype._promiseRejected = function (reason) {
	        this._totalResolved++;
	        this._reject(reason);
	        return true;
	    };

	    PromiseArray.prototype._resultCancelled = function () {
	        if (this._isResolved()) return;
	        var values = this._values;
	        this._cancel();
	        if (values instanceof Promise) {
	            values.cancel();
	        } else {
	            for (var i = 0; i < values.length; ++i) {
	                if (values[i] instanceof Promise) {
	                    values[i].cancel();
	                }
	            }
	        }
	    };

	    PromiseArray.prototype.shouldCopyValues = function () {
	        return true;
	    };

	    PromiseArray.prototype.getActualLength = function (len) {
	        return len;
	    };

	    return PromiseArray;
	};

/***/ },
/* 20 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise) {
	    var longStackTraces = false;
	    var contextStack = [];

	    Promise.prototype._promiseCreated = function () {};
	    Promise.prototype._pushContext = function () {};
	    Promise.prototype._popContext = function () {
	        return null;
	    };
	    Promise._peekContext = Promise.prototype._peekContext = function () {};

	    function Context() {
	        this._trace = new Context.CapturedTrace(peekContext());
	    }
	    Context.prototype._pushContext = function () {
	        if (this._trace !== undefined) {
	            this._trace._promiseCreated = null;
	            contextStack.push(this._trace);
	        }
	    };

	    Context.prototype._popContext = function () {
	        if (this._trace !== undefined) {
	            var trace = contextStack.pop();
	            var ret = trace._promiseCreated;
	            trace._promiseCreated = null;
	            return ret;
	        }
	        return null;
	    };

	    function createContext() {
	        if (longStackTraces) return new Context();
	    }

	    function peekContext() {
	        var lastIndex = contextStack.length - 1;
	        if (lastIndex >= 0) {
	            return contextStack[lastIndex];
	        }
	        return undefined;
	    }
	    Context.CapturedTrace = null;
	    Context.create = createContext;
	    Context.deactivateLongStackTraces = function () {};
	    Context.activateLongStackTraces = function () {
	        var Promise_pushContext = Promise.prototype._pushContext;
	        var Promise_popContext = Promise.prototype._popContext;
	        var Promise_PeekContext = Promise._peekContext;
	        var Promise_peekContext = Promise.prototype._peekContext;
	        var Promise_promiseCreated = Promise.prototype._promiseCreated;
	        Context.deactivateLongStackTraces = function () {
	            Promise.prototype._pushContext = Promise_pushContext;
	            Promise.prototype._popContext = Promise_popContext;
	            Promise._peekContext = Promise_PeekContext;
	            Promise.prototype._peekContext = Promise_peekContext;
	            Promise.prototype._promiseCreated = Promise_promiseCreated;
	            longStackTraces = false;
	        };
	        longStackTraces = true;
	        Promise.prototype._pushContext = Context.prototype._pushContext;
	        Promise.prototype._popContext = Context.prototype._popContext;
	        Promise._peekContext = Promise.prototype._peekContext = peekContext;
	        Promise.prototype._promiseCreated = function () {
	            var ctx = this._peekContext();
	            if (ctx && ctx._promiseCreated == null) ctx._promiseCreated = this;
	        };
	    };
	    return Context;
	};

/***/ },
/* 21 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, Context) {
	    var getDomain = Promise._getDomain;
	    var async = Promise._async;
	    var Warning = __webpack_require__(17).Warning;
	    var util = __webpack_require__(12);
	    var canAttachTrace = util.canAttachTrace;
	    var unhandledRejectionHandled;
	    var possiblyUnhandledRejection;
	    var bluebirdFramePattern = /[\\\/]bluebird[\\\/]js[\\\/](release|debug|instrumented)/;
	    var nodeFramePattern = /\((?:timers\.js):\d+:\d+\)/;
	    var parseLinePattern = /[\/<\(](.+?):(\d+):(\d+)\)?\s*$/;
	    var stackFramePattern = null;
	    var formatStack = null;
	    var indentStackFrames = false;
	    var printWarning;
	    var debugging = !!(util.env("BLUEBIRD_DEBUG") != 0 && (false || util.env("BLUEBIRD_DEBUG") || util.env("NODE_ENV") === "development"));

	    var warnings = !!(util.env("BLUEBIRD_WARNINGS") != 0 && (debugging || util.env("BLUEBIRD_WARNINGS")));

	    var longStackTraces = !!(util.env("BLUEBIRD_LONG_STACK_TRACES") != 0 && (debugging || util.env("BLUEBIRD_LONG_STACK_TRACES")));

	    var wForgottenReturn = util.env("BLUEBIRD_W_FORGOTTEN_RETURN") != 0 && (warnings || !!util.env("BLUEBIRD_W_FORGOTTEN_RETURN"));

	    Promise.prototype.suppressUnhandledRejections = function () {
	        var target = this._target();
	        target._bitField = target._bitField & ~1048576 | 524288;
	    };

	    Promise.prototype._ensurePossibleRejectionHandled = function () {
	        if ((this._bitField & 524288) !== 0) return;
	        this._setRejectionIsUnhandled();
	        async.invokeLater(this._notifyUnhandledRejection, this, undefined);
	    };

	    Promise.prototype._notifyUnhandledRejectionIsHandled = function () {
	        fireRejectionEvent("rejectionHandled", unhandledRejectionHandled, undefined, this);
	    };

	    Promise.prototype._setReturnedNonUndefined = function () {
	        this._bitField = this._bitField | 268435456;
	    };

	    Promise.prototype._returnedNonUndefined = function () {
	        return (this._bitField & 268435456) !== 0;
	    };

	    Promise.prototype._notifyUnhandledRejection = function () {
	        if (this._isRejectionUnhandled()) {
	            var reason = this._settledValue();
	            this._setUnhandledRejectionIsNotified();
	            fireRejectionEvent("unhandledRejection", possiblyUnhandledRejection, reason, this);
	        }
	    };

	    Promise.prototype._setUnhandledRejectionIsNotified = function () {
	        this._bitField = this._bitField | 262144;
	    };

	    Promise.prototype._unsetUnhandledRejectionIsNotified = function () {
	        this._bitField = this._bitField & ~262144;
	    };

	    Promise.prototype._isUnhandledRejectionNotified = function () {
	        return (this._bitField & 262144) > 0;
	    };

	    Promise.prototype._setRejectionIsUnhandled = function () {
	        this._bitField = this._bitField | 1048576;
	    };

	    Promise.prototype._unsetRejectionIsUnhandled = function () {
	        this._bitField = this._bitField & ~1048576;
	        if (this._isUnhandledRejectionNotified()) {
	            this._unsetUnhandledRejectionIsNotified();
	            this._notifyUnhandledRejectionIsHandled();
	        }
	    };

	    Promise.prototype._isRejectionUnhandled = function () {
	        return (this._bitField & 1048576) > 0;
	    };

	    Promise.prototype._warn = function (message, shouldUseOwnTrace, promise) {
	        return warn(message, shouldUseOwnTrace, promise || this);
	    };

	    Promise.onPossiblyUnhandledRejection = function (fn) {
	        var domain = getDomain();
	        possiblyUnhandledRejection = typeof fn === "function" ? domain === null ? fn : util.domainBind(domain, fn) : undefined;
	    };

	    Promise.onUnhandledRejectionHandled = function (fn) {
	        var domain = getDomain();
	        unhandledRejectionHandled = typeof fn === "function" ? domain === null ? fn : util.domainBind(domain, fn) : undefined;
	    };

	    var disableLongStackTraces = function () {};
	    Promise.longStackTraces = function () {
	        if (async.haveItemsQueued() && !config.longStackTraces) {
	            throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        if (!config.longStackTraces && longStackTracesIsSupported()) {
	            var Promise_captureStackTrace = Promise.prototype._captureStackTrace;
	            var Promise_attachExtraTrace = Promise.prototype._attachExtraTrace;
	            config.longStackTraces = true;
	            disableLongStackTraces = function () {
	                if (async.haveItemsQueued() && !config.longStackTraces) {
	                    throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	                }
	                Promise.prototype._captureStackTrace = Promise_captureStackTrace;
	                Promise.prototype._attachExtraTrace = Promise_attachExtraTrace;
	                Context.deactivateLongStackTraces();
	                async.enableTrampoline();
	                config.longStackTraces = false;
	            };
	            Promise.prototype._captureStackTrace = longStackTracesCaptureStackTrace;
	            Promise.prototype._attachExtraTrace = longStackTracesAttachExtraTrace;
	            Context.activateLongStackTraces();
	            async.disableTrampolineIfNecessary();
	        }
	    };

	    Promise.hasLongStackTraces = function () {
	        return config.longStackTraces && longStackTracesIsSupported();
	    };

	    var fireDomEvent = function () {
	        try {
	            if (typeof CustomEvent === "function") {
	                var event = new CustomEvent("CustomEvent");
	                util.global.dispatchEvent(event);
	                return function (name, event) {
	                    var domEvent = new CustomEvent(name.toLowerCase(), {
	                        detail: event,
	                        cancelable: true
	                    });
	                    return !util.global.dispatchEvent(domEvent);
	                };
	            } else if (typeof Event === "function") {
	                var event = new Event("CustomEvent");
	                util.global.dispatchEvent(event);
	                return function (name, event) {
	                    var domEvent = new Event(name.toLowerCase(), {
	                        cancelable: true
	                    });
	                    domEvent.detail = event;
	                    return !util.global.dispatchEvent(domEvent);
	                };
	            } else {
	                var event = document.createEvent("CustomEvent");
	                event.initCustomEvent("testingtheevent", false, true, {});
	                util.global.dispatchEvent(event);
	                return function (name, event) {
	                    var domEvent = document.createEvent("CustomEvent");
	                    domEvent.initCustomEvent(name.toLowerCase(), false, true, event);
	                    return !util.global.dispatchEvent(domEvent);
	                };
	            }
	        } catch (e) {}
	        return function () {
	            return false;
	        };
	    }();

	    var fireGlobalEvent = function () {
	        if (util.isNode) {
	            return function () {
	                return process.emit.apply(process, arguments);
	            };
	        } else {
	            if (!util.global) {
	                return function () {
	                    return false;
	                };
	            }
	            return function (name) {
	                var methodName = "on" + name.toLowerCase();
	                var method = util.global[methodName];
	                if (!method) return false;
	                method.apply(util.global, [].slice.call(arguments, 1));
	                return true;
	            };
	        }
	    }();

	    function generatePromiseLifecycleEventObject(name, promise) {
	        return { promise: promise };
	    }

	    var eventToObjectGenerator = {
	        promiseCreated: generatePromiseLifecycleEventObject,
	        promiseFulfilled: generatePromiseLifecycleEventObject,
	        promiseRejected: generatePromiseLifecycleEventObject,
	        promiseResolved: generatePromiseLifecycleEventObject,
	        promiseCancelled: generatePromiseLifecycleEventObject,
	        promiseChained: function (name, promise, child) {
	            return { promise: promise, child: child };
	        },
	        warning: function (name, warning) {
	            return { warning: warning };
	        },
	        unhandledRejection: function (name, reason, promise) {
	            return { reason: reason, promise: promise };
	        },
	        rejectionHandled: generatePromiseLifecycleEventObject
	    };

	    var activeFireEvent = function (name) {
	        var globalEventFired = false;
	        try {
	            globalEventFired = fireGlobalEvent.apply(null, arguments);
	        } catch (e) {
	            async.throwLater(e);
	            globalEventFired = true;
	        }

	        var domEventFired = false;
	        try {
	            domEventFired = fireDomEvent(name, eventToObjectGenerator[name].apply(null, arguments));
	        } catch (e) {
	            async.throwLater(e);
	            domEventFired = true;
	        }

	        return domEventFired || globalEventFired;
	    };

	    Promise.config = function (opts) {
	        opts = Object(opts);
	        if ("longStackTraces" in opts) {
	            if (opts.longStackTraces) {
	                Promise.longStackTraces();
	            } else if (!opts.longStackTraces && Promise.hasLongStackTraces()) {
	                disableLongStackTraces();
	            }
	        }
	        if ("warnings" in opts) {
	            var warningsOption = opts.warnings;
	            config.warnings = !!warningsOption;
	            wForgottenReturn = config.warnings;

	            if (util.isObject(warningsOption)) {
	                if ("wForgottenReturn" in warningsOption) {
	                    wForgottenReturn = !!warningsOption.wForgottenReturn;
	                }
	            }
	        }
	        if ("cancellation" in opts && opts.cancellation && !config.cancellation) {
	            if (async.haveItemsQueued()) {
	                throw new Error("cannot enable cancellation after promises are in use");
	            }
	            Promise.prototype._clearCancellationData = cancellationClearCancellationData;
	            Promise.prototype._propagateFrom = cancellationPropagateFrom;
	            Promise.prototype._onCancel = cancellationOnCancel;
	            Promise.prototype._setOnCancel = cancellationSetOnCancel;
	            Promise.prototype._attachCancellationCallback = cancellationAttachCancellationCallback;
	            Promise.prototype._execute = cancellationExecute;
	            propagateFromFunction = cancellationPropagateFrom;
	            config.cancellation = true;
	        }
	        if ("monitoring" in opts) {
	            if (opts.monitoring && !config.monitoring) {
	                config.monitoring = true;
	                Promise.prototype._fireEvent = activeFireEvent;
	            } else if (!opts.monitoring && config.monitoring) {
	                config.monitoring = false;
	                Promise.prototype._fireEvent = defaultFireEvent;
	            }
	        }
	    };

	    function defaultFireEvent() {
	        return false;
	    }

	    Promise.prototype._fireEvent = defaultFireEvent;
	    Promise.prototype._execute = function (executor, resolve, reject) {
	        try {
	            executor(resolve, reject);
	        } catch (e) {
	            return e;
	        }
	    };
	    Promise.prototype._onCancel = function () {};
	    Promise.prototype._setOnCancel = function (handler) {
	        ;
	    };
	    Promise.prototype._attachCancellationCallback = function (onCancel) {
	        ;
	    };
	    Promise.prototype._captureStackTrace = function () {};
	    Promise.prototype._attachExtraTrace = function () {};
	    Promise.prototype._clearCancellationData = function () {};
	    Promise.prototype._propagateFrom = function (parent, flags) {
	        ;
	        ;
	    };

	    function cancellationExecute(executor, resolve, reject) {
	        var promise = this;
	        try {
	            executor(resolve, reject, function (onCancel) {
	                if (typeof onCancel !== "function") {
	                    throw new TypeError("onCancel must be a function, got: " + util.toString(onCancel));
	                }
	                promise._attachCancellationCallback(onCancel);
	            });
	        } catch (e) {
	            return e;
	        }
	    }

	    function cancellationAttachCancellationCallback(onCancel) {
	        if (!this._isCancellable()) return this;

	        var previousOnCancel = this._onCancel();
	        if (previousOnCancel !== undefined) {
	            if (util.isArray(previousOnCancel)) {
	                previousOnCancel.push(onCancel);
	            } else {
	                this._setOnCancel([previousOnCancel, onCancel]);
	            }
	        } else {
	            this._setOnCancel(onCancel);
	        }
	    }

	    function cancellationOnCancel() {
	        return this._onCancelField;
	    }

	    function cancellationSetOnCancel(onCancel) {
	        this._onCancelField = onCancel;
	    }

	    function cancellationClearCancellationData() {
	        this._cancellationParent = undefined;
	        this._onCancelField = undefined;
	    }

	    function cancellationPropagateFrom(parent, flags) {
	        if ((flags & 1) !== 0) {
	            this._cancellationParent = parent;
	            var branchesRemainingToCancel = parent._branchesRemainingToCancel;
	            if (branchesRemainingToCancel === undefined) {
	                branchesRemainingToCancel = 0;
	            }
	            parent._branchesRemainingToCancel = branchesRemainingToCancel + 1;
	        }
	        if ((flags & 2) !== 0 && parent._isBound()) {
	            this._setBoundTo(parent._boundTo);
	        }
	    }

	    function bindingPropagateFrom(parent, flags) {
	        if ((flags & 2) !== 0 && parent._isBound()) {
	            this._setBoundTo(parent._boundTo);
	        }
	    }
	    var propagateFromFunction = bindingPropagateFrom;

	    function boundValueFunction() {
	        var ret = this._boundTo;
	        if (ret !== undefined) {
	            if (ret instanceof Promise) {
	                if (ret.isFulfilled()) {
	                    return ret.value();
	                } else {
	                    return undefined;
	                }
	            }
	        }
	        return ret;
	    }

	    function longStackTracesCaptureStackTrace() {
	        this._trace = new CapturedTrace(this._peekContext());
	    }

	    function longStackTracesAttachExtraTrace(error, ignoreSelf) {
	        if (canAttachTrace(error)) {
	            var trace = this._trace;
	            if (trace !== undefined) {
	                if (ignoreSelf) trace = trace._parent;
	            }
	            if (trace !== undefined) {
	                trace.attachExtraTrace(error);
	            } else if (!error.__stackCleaned__) {
	                var parsed = parseStackAndMessage(error);
	                util.notEnumerableProp(error, "stack", parsed.message + "\n" + parsed.stack.join("\n"));
	                util.notEnumerableProp(error, "__stackCleaned__", true);
	            }
	        }
	    }

	    function checkForgottenReturns(returnValue, promiseCreated, name, promise, parent) {
	        if (returnValue === undefined && promiseCreated !== null && wForgottenReturn) {
	            if (parent !== undefined && parent._returnedNonUndefined()) return;
	            if ((promise._bitField & 65535) === 0) return;

	            if (name) name = name + " ";
	            var handlerLine = "";
	            var creatorLine = "";
	            if (promiseCreated._trace) {
	                var traceLines = promiseCreated._trace.stack.split("\n");
	                var stack = cleanStack(traceLines);
	                for (var i = stack.length - 1; i >= 0; --i) {
	                    var line = stack[i];
	                    if (!nodeFramePattern.test(line)) {
	                        var lineMatches = line.match(parseLinePattern);
	                        if (lineMatches) {
	                            handlerLine = "at " + lineMatches[1] + ":" + lineMatches[2] + ":" + lineMatches[3] + " ";
	                        }
	                        break;
	                    }
	                }

	                if (stack.length > 0) {
	                    var firstUserLine = stack[0];
	                    for (var i = 0; i < traceLines.length; ++i) {

	                        if (traceLines[i] === firstUserLine) {
	                            if (i > 0) {
	                                creatorLine = "\n" + traceLines[i - 1];
	                            }
	                            break;
	                        }
	                    }
	                }
	            }
	            var msg = "a promise was created in a " + name + "handler " + handlerLine + "but was not returned from it, " + "see http://goo.gl/rRqMUw" + creatorLine;
	            promise._warn(msg, true, promiseCreated);
	        }
	    }

	    function deprecated(name, replacement) {
	        var message = name + " is deprecated and will be removed in a future version.";
	        if (replacement) message += " Use " + replacement + " instead.";
	        return warn(message);
	    }

	    function warn(message, shouldUseOwnTrace, promise) {
	        if (!config.warnings) return;
	        var warning = new Warning(message);
	        var ctx;
	        if (shouldUseOwnTrace) {
	            promise._attachExtraTrace(warning);
	        } else if (config.longStackTraces && (ctx = Promise._peekContext())) {
	            ctx.attachExtraTrace(warning);
	        } else {
	            var parsed = parseStackAndMessage(warning);
	            warning.stack = parsed.message + "\n" + parsed.stack.join("\n");
	        }

	        if (!activeFireEvent("warning", warning)) {
	            formatAndLogError(warning, "", true);
	        }
	    }

	    function reconstructStack(message, stacks) {
	        for (var i = 0; i < stacks.length - 1; ++i) {
	            stacks[i].push("From previous event:");
	            stacks[i] = stacks[i].join("\n");
	        }
	        if (i < stacks.length) {
	            stacks[i] = stacks[i].join("\n");
	        }
	        return message + "\n" + stacks.join("\n");
	    }

	    function removeDuplicateOrEmptyJumps(stacks) {
	        for (var i = 0; i < stacks.length; ++i) {
	            if (stacks[i].length === 0 || i + 1 < stacks.length && stacks[i][0] === stacks[i + 1][0]) {
	                stacks.splice(i, 1);
	                i--;
	            }
	        }
	    }

	    function removeCommonRoots(stacks) {
	        var current = stacks[0];
	        for (var i = 1; i < stacks.length; ++i) {
	            var prev = stacks[i];
	            var currentLastIndex = current.length - 1;
	            var currentLastLine = current[currentLastIndex];
	            var commonRootMeetPoint = -1;

	            for (var j = prev.length - 1; j >= 0; --j) {
	                if (prev[j] === currentLastLine) {
	                    commonRootMeetPoint = j;
	                    break;
	                }
	            }

	            for (var j = commonRootMeetPoint; j >= 0; --j) {
	                var line = prev[j];
	                if (current[currentLastIndex] === line) {
	                    current.pop();
	                    currentLastIndex--;
	                } else {
	                    break;
	                }
	            }
	            current = prev;
	        }
	    }

	    function cleanStack(stack) {
	        var ret = [];
	        for (var i = 0; i < stack.length; ++i) {
	            var line = stack[i];
	            var isTraceLine = "    (No stack trace)" === line || stackFramePattern.test(line);
	            var isInternalFrame = isTraceLine && shouldIgnore(line);
	            if (isTraceLine && !isInternalFrame) {
	                if (indentStackFrames && line.charAt(0) !== " ") {
	                    line = "    " + line;
	                }
	                ret.push(line);
	            }
	        }
	        return ret;
	    }

	    function stackFramesAsArray(error) {
	        var stack = error.stack.replace(/\s+$/g, "").split("\n");
	        for (var i = 0; i < stack.length; ++i) {
	            var line = stack[i];
	            if ("    (No stack trace)" === line || stackFramePattern.test(line)) {
	                break;
	            }
	        }
	        if (i > 0) {
	            stack = stack.slice(i);
	        }
	        return stack;
	    }

	    function parseStackAndMessage(error) {
	        var stack = error.stack;
	        var message = error.toString();
	        stack = typeof stack === "string" && stack.length > 0 ? stackFramesAsArray(error) : ["    (No stack trace)"];
	        return {
	            message: message,
	            stack: cleanStack(stack)
	        };
	    }

	    function formatAndLogError(error, title, isSoft) {
	        if (typeof console !== "undefined") {
	            var message;
	            if (util.isObject(error)) {
	                var stack = error.stack;
	                message = title + formatStack(stack, error);
	            } else {
	                message = title + String(error);
	            }
	            if (typeof printWarning === "function") {
	                printWarning(message, isSoft);
	            } else if (typeof console.log === "function" || typeof console.log === "object") {
	                console.log(message);
	            }
	        }
	    }

	    function fireRejectionEvent(name, localHandler, reason, promise) {
	        var localEventFired = false;
	        try {
	            if (typeof localHandler === "function") {
	                localEventFired = true;
	                if (name === "rejectionHandled") {
	                    localHandler(promise);
	                } else {
	                    localHandler(reason, promise);
	                }
	            }
	        } catch (e) {
	            async.throwLater(e);
	        }

	        if (name === "unhandledRejection") {
	            if (!activeFireEvent(name, reason, promise) && !localEventFired) {
	                formatAndLogError(reason, "Unhandled rejection ");
	            }
	        } else {
	            activeFireEvent(name, promise);
	        }
	    }

	    function formatNonError(obj) {
	        var str;
	        if (typeof obj === "function") {
	            str = "[function " + (obj.name || "anonymous") + "]";
	        } else {
	            str = obj && typeof obj.toString === "function" ? obj.toString() : util.toString(obj);
	            var ruselessToString = /\[object [a-zA-Z0-9$_]+\]/;
	            if (ruselessToString.test(str)) {
	                try {
	                    var newStr = JSON.stringify(obj);
	                    str = newStr;
	                } catch (e) {}
	            }
	            if (str.length === 0) {
	                str = "(empty array)";
	            }
	        }
	        return "(<" + snip(str) + ">, no stack trace)";
	    }

	    function snip(str) {
	        var maxChars = 41;
	        if (str.length < maxChars) {
	            return str;
	        }
	        return str.substr(0, maxChars - 3) + "...";
	    }

	    function longStackTracesIsSupported() {
	        return typeof captureStackTrace === "function";
	    }

	    var shouldIgnore = function () {
	        return false;
	    };
	    var parseLineInfoRegex = /[\/<\(]([^:\/]+):(\d+):(?:\d+)\)?\s*$/;
	    function parseLineInfo(line) {
	        var matches = line.match(parseLineInfoRegex);
	        if (matches) {
	            return {
	                fileName: matches[1],
	                line: parseInt(matches[2], 10)
	            };
	        }
	    }

	    function setBounds(firstLineError, lastLineError) {
	        if (!longStackTracesIsSupported()) return;
	        var firstStackLines = firstLineError.stack.split("\n");
	        var lastStackLines = lastLineError.stack.split("\n");
	        var firstIndex = -1;
	        var lastIndex = -1;
	        var firstFileName;
	        var lastFileName;
	        for (var i = 0; i < firstStackLines.length; ++i) {
	            var result = parseLineInfo(firstStackLines[i]);
	            if (result) {
	                firstFileName = result.fileName;
	                firstIndex = result.line;
	                break;
	            }
	        }
	        for (var i = 0; i < lastStackLines.length; ++i) {
	            var result = parseLineInfo(lastStackLines[i]);
	            if (result) {
	                lastFileName = result.fileName;
	                lastIndex = result.line;
	                break;
	            }
	        }
	        if (firstIndex < 0 || lastIndex < 0 || !firstFileName || !lastFileName || firstFileName !== lastFileName || firstIndex >= lastIndex) {
	            return;
	        }

	        shouldIgnore = function (line) {
	            if (bluebirdFramePattern.test(line)) return true;
	            var info = parseLineInfo(line);
	            if (info) {
	                if (info.fileName === firstFileName && firstIndex <= info.line && info.line <= lastIndex) {
	                    return true;
	                }
	            }
	            return false;
	        };
	    }

	    function CapturedTrace(parent) {
	        this._parent = parent;
	        this._promisesCreated = 0;
	        var length = this._length = 1 + (parent === undefined ? 0 : parent._length);
	        captureStackTrace(this, CapturedTrace);
	        if (length > 32) this.uncycle();
	    }
	    util.inherits(CapturedTrace, Error);
	    Context.CapturedTrace = CapturedTrace;

	    CapturedTrace.prototype.uncycle = function () {
	        var length = this._length;
	        if (length < 2) return;
	        var nodes = [];
	        var stackToIndex = {};

	        for (var i = 0, node = this; node !== undefined; ++i) {
	            nodes.push(node);
	            node = node._parent;
	        }
	        length = this._length = i;
	        for (var i = length - 1; i >= 0; --i) {
	            var stack = nodes[i].stack;
	            if (stackToIndex[stack] === undefined) {
	                stackToIndex[stack] = i;
	            }
	        }
	        for (var i = 0; i < length; ++i) {
	            var currentStack = nodes[i].stack;
	            var index = stackToIndex[currentStack];
	            if (index !== undefined && index !== i) {
	                if (index > 0) {
	                    nodes[index - 1]._parent = undefined;
	                    nodes[index - 1]._length = 1;
	                }
	                nodes[i]._parent = undefined;
	                nodes[i]._length = 1;
	                var cycleEdgeNode = i > 0 ? nodes[i - 1] : this;

	                if (index < length - 1) {
	                    cycleEdgeNode._parent = nodes[index + 1];
	                    cycleEdgeNode._parent.uncycle();
	                    cycleEdgeNode._length = cycleEdgeNode._parent._length + 1;
	                } else {
	                    cycleEdgeNode._parent = undefined;
	                    cycleEdgeNode._length = 1;
	                }
	                var currentChildLength = cycleEdgeNode._length + 1;
	                for (var j = i - 2; j >= 0; --j) {
	                    nodes[j]._length = currentChildLength;
	                    currentChildLength++;
	                }
	                return;
	            }
	        }
	    };

	    CapturedTrace.prototype.attachExtraTrace = function (error) {
	        if (error.__stackCleaned__) return;
	        this.uncycle();
	        var parsed = parseStackAndMessage(error);
	        var message = parsed.message;
	        var stacks = [parsed.stack];

	        var trace = this;
	        while (trace !== undefined) {
	            stacks.push(cleanStack(trace.stack.split("\n")));
	            trace = trace._parent;
	        }
	        removeCommonRoots(stacks);
	        removeDuplicateOrEmptyJumps(stacks);
	        util.notEnumerableProp(error, "stack", reconstructStack(message, stacks));
	        util.notEnumerableProp(error, "__stackCleaned__", true);
	    };

	    var captureStackTrace = function stackDetection() {
	        var v8stackFramePattern = /^\s*at\s*/;
	        var v8stackFormatter = function (stack, error) {
	            if (typeof stack === "string") return stack;

	            if (error.name !== undefined && error.message !== undefined) {
	                return error.toString();
	            }
	            return formatNonError(error);
	        };

	        if (typeof Error.stackTraceLimit === "number" && typeof Error.captureStackTrace === "function") {
	            Error.stackTraceLimit += 6;
	            stackFramePattern = v8stackFramePattern;
	            formatStack = v8stackFormatter;
	            var captureStackTrace = Error.captureStackTrace;

	            shouldIgnore = function (line) {
	                return bluebirdFramePattern.test(line);
	            };
	            return function (receiver, ignoreUntil) {
	                Error.stackTraceLimit += 6;
	                captureStackTrace(receiver, ignoreUntil);
	                Error.stackTraceLimit -= 6;
	            };
	        }
	        var err = new Error();

	        if (typeof err.stack === "string" && err.stack.split("\n")[0].indexOf("stackDetection@") >= 0) {
	            stackFramePattern = /@/;
	            formatStack = v8stackFormatter;
	            indentStackFrames = true;
	            return function captureStackTrace(o) {
	                o.stack = new Error().stack;
	            };
	        }

	        var hasStackAfterThrow;
	        try {
	            throw new Error();
	        } catch (e) {
	            hasStackAfterThrow = "stack" in e;
	        }
	        if (!("stack" in err) && hasStackAfterThrow && typeof Error.stackTraceLimit === "number") {
	            stackFramePattern = v8stackFramePattern;
	            formatStack = v8stackFormatter;
	            return function captureStackTrace(o) {
	                Error.stackTraceLimit += 6;
	                try {
	                    throw new Error();
	                } catch (e) {
	                    o.stack = e.stack;
	                }
	                Error.stackTraceLimit -= 6;
	            };
	        }

	        formatStack = function (stack, error) {
	            if (typeof stack === "string") return stack;

	            if ((typeof error === "object" || typeof error === "function") && error.name !== undefined && error.message !== undefined) {
	                return error.toString();
	            }
	            return formatNonError(error);
	        };

	        return null;
	    }([]);

	    if (typeof console !== "undefined" && typeof console.warn !== "undefined") {
	        printWarning = function (message) {
	            console.warn(message);
	        };
	        if (util.isNode && process.stderr.isTTY) {
	            printWarning = function (message, isSoft) {
	                var color = isSoft ? "\u001b[33m" : "\u001b[31m";
	                console.warn(color + message + "\u001b[0m\n");
	            };
	        } else if (!util.isNode && typeof new Error().stack === "string") {
	            printWarning = function (message, isSoft) {
	                console.warn("%c" + message, isSoft ? "color: darkorange" : "color: red");
	            };
	        }
	    }

	    var config = {
	        warnings: warnings,
	        longStackTraces: false,
	        cancellation: false,
	        monitoring: false
	    };

	    if (longStackTraces) Promise.longStackTraces();

	    return {
	        longStackTraces: function () {
	            return config.longStackTraces;
	        },
	        warnings: function () {
	            return config.warnings;
	        },
	        cancellation: function () {
	            return config.cancellation;
	        },
	        monitoring: function () {
	            return config.monitoring;
	        },
	        propagateFromFunction: function () {
	            return propagateFromFunction;
	        },
	        boundValueFunction: function () {
	            return boundValueFunction;
	        },
	        checkForgottenReturns: checkForgottenReturns,
	        setBounds: setBounds,
	        warn: warn,
	        deprecated: deprecated,
	        CapturedTrace: CapturedTrace,
	        fireDomEvent: fireDomEvent,
	        fireGlobalEvent: fireGlobalEvent
	    };
	};

/***/ },
/* 22 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, tryConvertToPromise) {
	    var util = __webpack_require__(12);
	    var CancellationError = Promise.CancellationError;
	    var errorObj = util.errorObj;

	    function PassThroughHandlerContext(promise, type, handler) {
	        this.promise = promise;
	        this.type = type;
	        this.handler = handler;
	        this.called = false;
	        this.cancelPromise = null;
	    }

	    PassThroughHandlerContext.prototype.isFinallyHandler = function () {
	        return this.type === 0;
	    };

	    function FinallyHandlerCancelReaction(finallyHandler) {
	        this.finallyHandler = finallyHandler;
	    }

	    FinallyHandlerCancelReaction.prototype._resultCancelled = function () {
	        checkCancel(this.finallyHandler);
	    };

	    function checkCancel(ctx, reason) {
	        if (ctx.cancelPromise != null) {
	            if (arguments.length > 1) {
	                ctx.cancelPromise._reject(reason);
	            } else {
	                ctx.cancelPromise._cancel();
	            }
	            ctx.cancelPromise = null;
	            return true;
	        }
	        return false;
	    }

	    function succeed() {
	        return finallyHandler.call(this, this.promise._target()._settledValue());
	    }
	    function fail(reason) {
	        if (checkCancel(this, reason)) return;
	        errorObj.e = reason;
	        return errorObj;
	    }
	    function finallyHandler(reasonOrValue) {
	        var promise = this.promise;
	        var handler = this.handler;

	        if (!this.called) {
	            this.called = true;
	            var ret = this.isFinallyHandler() ? handler.call(promise._boundValue()) : handler.call(promise._boundValue(), reasonOrValue);
	            if (ret !== undefined) {
	                promise._setReturnedNonUndefined();
	                var maybePromise = tryConvertToPromise(ret, promise);
	                if (maybePromise instanceof Promise) {
	                    if (this.cancelPromise != null) {
	                        if (maybePromise._isCancelled()) {
	                            var reason = new CancellationError("late cancellation observer");
	                            promise._attachExtraTrace(reason);
	                            errorObj.e = reason;
	                            return errorObj;
	                        } else if (maybePromise.isPending()) {
	                            maybePromise._attachCancellationCallback(new FinallyHandlerCancelReaction(this));
	                        }
	                    }
	                    return maybePromise._then(succeed, fail, undefined, this, undefined);
	                }
	            }
	        }

	        if (promise.isRejected()) {
	            checkCancel(this);
	            errorObj.e = reasonOrValue;
	            return errorObj;
	        } else {
	            checkCancel(this);
	            return reasonOrValue;
	        }
	    }

	    Promise.prototype._passThrough = function (handler, type, success, fail) {
	        if (typeof handler !== "function") return this.then();
	        return this._then(success, fail, undefined, new PassThroughHandlerContext(this, type, handler), undefined);
	    };

	    Promise.prototype.lastly = Promise.prototype["finally"] = function (handler) {
	        return this._passThrough(handler, 0, finallyHandler, finallyHandler);
	    };

	    Promise.prototype.tap = function (handler) {
	        return this._passThrough(handler, 1, finallyHandler);
	    };

	    return PassThroughHandlerContext;
	};

/***/ },
/* 23 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (NEXT_FILTER) {
	    var util = __webpack_require__(12);
	    var getKeys = __webpack_require__(13).keys;
	    var tryCatch = util.tryCatch;
	    var errorObj = util.errorObj;

	    function catchFilter(instances, cb, promise) {
	        return function (e) {
	            var boundTo = promise._boundValue();
	            predicateLoop: for (var i = 0; i < instances.length; ++i) {
	                var item = instances[i];

	                if (item === Error || item != null && item.prototype instanceof Error) {
	                    if (e instanceof item) {
	                        return tryCatch(cb).call(boundTo, e);
	                    }
	                } else if (typeof item === "function") {
	                    var matchesPredicate = tryCatch(item).call(boundTo, e);
	                    if (matchesPredicate === errorObj) {
	                        return matchesPredicate;
	                    } else if (matchesPredicate) {
	                        return tryCatch(cb).call(boundTo, e);
	                    }
	                } else if (util.isObject(e)) {
	                    var keys = getKeys(item);
	                    for (var j = 0; j < keys.length; ++j) {
	                        var key = keys[j];
	                        if (item[key] != e[key]) {
	                            continue predicateLoop;
	                        }
	                    }
	                    return tryCatch(cb).call(boundTo, e);
	                }
	            }
	            return NEXT_FILTER;
	        };
	    }

	    return catchFilter;
	};

/***/ },
/* 24 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var util = __webpack_require__(12);
	var maybeWrapAsError = util.maybeWrapAsError;
	var errors = __webpack_require__(17);
	var OperationalError = errors.OperationalError;
	var es5 = __webpack_require__(13);

	function isUntypedError(obj) {
	    return obj instanceof Error && es5.getPrototypeOf(obj) === Error.prototype;
	}

	var rErrorKey = /^(?:name|message|stack|cause)$/;
	function wrapAsOperationalError(obj) {
	    var ret;
	    if (isUntypedError(obj)) {
	        ret = new OperationalError(obj);
	        ret.name = obj.name;
	        ret.message = obj.message;
	        ret.stack = obj.stack;
	        var keys = es5.keys(obj);
	        for (var i = 0; i < keys.length; ++i) {
	            var key = keys[i];
	            if (!rErrorKey.test(key)) {
	                ret[key] = obj[key];
	            }
	        }
	        return ret;
	    }
	    util.markAsOriginatingFromRejection(obj);
	    return obj;
	}

	function nodebackForPromise(promise, multiArgs) {
	    return function (err, value) {
	        if (promise === null) return;
	        if (err) {
	            var wrapped = wrapAsOperationalError(maybeWrapAsError(err));
	            promise._attachExtraTrace(wrapped);
	            promise._reject(wrapped);
	        } else if (!multiArgs) {
	            promise._fulfill(value);
	        } else {
	            var $_len = arguments.length;var args = new Array(Math.max($_len - 1, 0));for (var $_i = 1; $_i < $_len; ++$_i) {
	                args[$_i - 1] = arguments[$_i];
	            };
	            promise._fulfill(args);
	        }
	        promise = null;
	    };
	}

	module.exports = nodebackForPromise;

/***/ },
/* 25 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, INTERNAL, tryConvertToPromise, apiRejection, debug) {
	    var util = __webpack_require__(12);
	    var tryCatch = util.tryCatch;

	    Promise.method = function (fn) {
	        if (typeof fn !== "function") {
	            throw new Promise.TypeError("expecting a function but got " + util.classString(fn));
	        }
	        return function () {
	            var ret = new Promise(INTERNAL);
	            ret._captureStackTrace();
	            ret._pushContext();
	            var value = tryCatch(fn).apply(this, arguments);
	            var promiseCreated = ret._popContext();
	            debug.checkForgottenReturns(value, promiseCreated, "Promise.method", ret);
	            ret._resolveFromSyncValue(value);
	            return ret;
	        };
	    };

	    Promise.attempt = Promise["try"] = function (fn) {
	        if (typeof fn !== "function") {
	            return apiRejection("expecting a function but got " + util.classString(fn));
	        }
	        var ret = new Promise(INTERNAL);
	        ret._captureStackTrace();
	        ret._pushContext();
	        var value;
	        if (arguments.length > 1) {
	            debug.deprecated("calling Promise.try with more than 1 argument");
	            var arg = arguments[1];
	            var ctx = arguments[2];
	            value = util.isArray(arg) ? tryCatch(fn).apply(ctx, arg) : tryCatch(fn).call(ctx, arg);
	        } else {
	            value = tryCatch(fn)();
	        }
	        var promiseCreated = ret._popContext();
	        debug.checkForgottenReturns(value, promiseCreated, "Promise.try", ret);
	        ret._resolveFromSyncValue(value);
	        return ret;
	    };

	    Promise.prototype._resolveFromSyncValue = function (value) {
	        if (value === util.errorObj) {
	            this._rejectCallback(value.e, false);
	        } else {
	            this._resolveCallback(value, true);
	        }
	    };
	};

/***/ },
/* 26 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise, INTERNAL, tryConvertToPromise, debug) {
	    var calledBind = false;
	    var rejectThis = function (_, e) {
	        this._reject(e);
	    };

	    var targetRejected = function (e, context) {
	        context.promiseRejectionQueued = true;
	        context.bindingPromise._then(rejectThis, rejectThis, null, this, e);
	    };

	    var bindingResolved = function (thisArg, context) {
	        if ((this._bitField & 50397184) === 0) {
	            this._resolveCallback(context.target);
	        }
	    };

	    var bindingRejected = function (e, context) {
	        if (!context.promiseRejectionQueued) this._reject(e);
	    };

	    Promise.prototype.bind = function (thisArg) {
	        if (!calledBind) {
	            calledBind = true;
	            Promise.prototype._propagateFrom = debug.propagateFromFunction();
	            Promise.prototype._boundValue = debug.boundValueFunction();
	        }
	        var maybePromise = tryConvertToPromise(thisArg);
	        var ret = new Promise(INTERNAL);
	        ret._propagateFrom(this, 1);
	        var target = this._target();
	        ret._setBoundTo(maybePromise);
	        if (maybePromise instanceof Promise) {
	            var context = {
	                promiseRejectionQueued: false,
	                promise: ret,
	                target: target,
	                bindingPromise: maybePromise
	            };
	            target._then(INTERNAL, targetRejected, undefined, ret, context);
	            maybePromise._then(bindingResolved, bindingRejected, undefined, ret, context);
	            ret._setOnCancel(maybePromise);
	        } else {
	            ret._resolveCallback(target);
	        }
	        return ret;
	    };

	    Promise.prototype._setBoundTo = function (obj) {
	        if (obj !== undefined) {
	            this._bitField = this._bitField | 2097152;
	            this._boundTo = obj;
	        } else {
	            this._bitField = this._bitField & ~2097152;
	        }
	    };

	    Promise.prototype._isBound = function () {
	        return (this._bitField & 2097152) === 2097152;
	    };

	    Promise.bind = function (thisArg, value) {
	        return Promise.resolve(value).bind(thisArg);
	    };
	};

/***/ },
/* 27 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, apiRejection, debug) {
	    var util = __webpack_require__(12);
	    var tryCatch = util.tryCatch;
	    var errorObj = util.errorObj;
	    var async = Promise._async;

	    Promise.prototype["break"] = Promise.prototype.cancel = function () {
	        if (!debug.cancellation()) return this._warn("cancellation is disabled");

	        var promise = this;
	        var child = promise;
	        while (promise._isCancellable()) {
	            if (!promise._cancelBy(child)) {
	                if (child._isFollowing()) {
	                    child._followee().cancel();
	                } else {
	                    child._cancelBranched();
	                }
	                break;
	            }

	            var parent = promise._cancellationParent;
	            if (parent == null || !parent._isCancellable()) {
	                if (promise._isFollowing()) {
	                    promise._followee().cancel();
	                } else {
	                    promise._cancelBranched();
	                }
	                break;
	            } else {
	                if (promise._isFollowing()) promise._followee().cancel();
	                promise._setWillBeCancelled();
	                child = promise;
	                promise = parent;
	            }
	        }
	    };

	    Promise.prototype._branchHasCancelled = function () {
	        this._branchesRemainingToCancel--;
	    };

	    Promise.prototype._enoughBranchesHaveCancelled = function () {
	        return this._branchesRemainingToCancel === undefined || this._branchesRemainingToCancel <= 0;
	    };

	    Promise.prototype._cancelBy = function (canceller) {
	        if (canceller === this) {
	            this._branchesRemainingToCancel = 0;
	            this._invokeOnCancel();
	            return true;
	        } else {
	            this._branchHasCancelled();
	            if (this._enoughBranchesHaveCancelled()) {
	                this._invokeOnCancel();
	                return true;
	            }
	        }
	        return false;
	    };

	    Promise.prototype._cancelBranched = function () {
	        if (this._enoughBranchesHaveCancelled()) {
	            this._cancel();
	        }
	    };

	    Promise.prototype._cancel = function () {
	        if (!this._isCancellable()) return;
	        this._setCancelled();
	        async.invoke(this._cancelPromises, this, undefined);
	    };

	    Promise.prototype._cancelPromises = function () {
	        if (this._length() > 0) this._settlePromises();
	    };

	    Promise.prototype._unsetOnCancel = function () {
	        this._onCancelField = undefined;
	    };

	    Promise.prototype._isCancellable = function () {
	        return this.isPending() && !this._isCancelled();
	    };

	    Promise.prototype.isCancellable = function () {
	        return this.isPending() && !this.isCancelled();
	    };

	    Promise.prototype._doInvokeOnCancel = function (onCancelCallback, internalOnly) {
	        if (util.isArray(onCancelCallback)) {
	            for (var i = 0; i < onCancelCallback.length; ++i) {
	                this._doInvokeOnCancel(onCancelCallback[i], internalOnly);
	            }
	        } else if (onCancelCallback !== undefined) {
	            if (typeof onCancelCallback === "function") {
	                if (!internalOnly) {
	                    var e = tryCatch(onCancelCallback).call(this._boundValue());
	                    if (e === errorObj) {
	                        this._attachExtraTrace(e.e);
	                        async.throwLater(e.e);
	                    }
	                }
	            } else {
	                onCancelCallback._resultCancelled(this);
	            }
	        }
	    };

	    Promise.prototype._invokeOnCancel = function () {
	        var onCancelCallback = this._onCancel();
	        this._unsetOnCancel();
	        async.invoke(this._doInvokeOnCancel, this, onCancelCallback);
	    };

	    Promise.prototype._invokeInternalOnCancel = function () {
	        if (this._isCancellable()) {
	            this._doInvokeOnCancel(this._onCancel(), true);
	            this._unsetOnCancel();
	        }
	    };

	    Promise.prototype._resultCancelled = function () {
	        this.cancel();
	    };
	};

/***/ },
/* 28 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise) {
	    function returner() {
	        return this.value;
	    }
	    function thrower() {
	        throw this.reason;
	    }

	    Promise.prototype["return"] = Promise.prototype.thenReturn = function (value) {
	        if (value instanceof Promise) value.suppressUnhandledRejections();
	        return this._then(returner, undefined, undefined, { value: value }, undefined);
	    };

	    Promise.prototype["throw"] = Promise.prototype.thenThrow = function (reason) {
	        return this._then(thrower, undefined, undefined, { reason: reason }, undefined);
	    };

	    Promise.prototype.catchThrow = function (reason) {
	        if (arguments.length <= 1) {
	            return this._then(undefined, thrower, undefined, { reason: reason }, undefined);
	        } else {
	            var _reason = arguments[1];
	            var handler = function () {
	                throw _reason;
	            };
	            return this.caught(reason, handler);
	        }
	    };

	    Promise.prototype.catchReturn = function (value) {
	        if (arguments.length <= 1) {
	            if (value instanceof Promise) value.suppressUnhandledRejections();
	            return this._then(undefined, returner, undefined, { value: value }, undefined);
	        } else {
	            var _value = arguments[1];
	            if (_value instanceof Promise) _value.suppressUnhandledRejections();
	            var handler = function () {
	                return _value;
	            };
	            return this.caught(value, handler);
	        }
	    };
	};

/***/ },
/* 29 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise) {
	    function PromiseInspection(promise) {
	        if (promise !== undefined) {
	            promise = promise._target();
	            this._bitField = promise._bitField;
	            this._settledValueField = promise._isFateSealed() ? promise._settledValue() : undefined;
	        } else {
	            this._bitField = 0;
	            this._settledValueField = undefined;
	        }
	    }

	    PromiseInspection.prototype._settledValue = function () {
	        return this._settledValueField;
	    };

	    var value = PromiseInspection.prototype.value = function () {
	        if (!this.isFulfilled()) {
	            throw new TypeError("cannot get fulfillment value of a non-fulfilled promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        return this._settledValue();
	    };

	    var reason = PromiseInspection.prototype.error = PromiseInspection.prototype.reason = function () {
	        if (!this.isRejected()) {
	            throw new TypeError("cannot get rejection reason of a non-rejected promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        return this._settledValue();
	    };

	    var isFulfilled = PromiseInspection.prototype.isFulfilled = function () {
	        return (this._bitField & 33554432) !== 0;
	    };

	    var isRejected = PromiseInspection.prototype.isRejected = function () {
	        return (this._bitField & 16777216) !== 0;
	    };

	    var isPending = PromiseInspection.prototype.isPending = function () {
	        return (this._bitField & 50397184) === 0;
	    };

	    var isResolved = PromiseInspection.prototype.isResolved = function () {
	        return (this._bitField & 50331648) !== 0;
	    };

	    PromiseInspection.prototype.isCancelled = function () {
	        return (this._bitField & 8454144) !== 0;
	    };

	    Promise.prototype.__isCancelled = function () {
	        return (this._bitField & 65536) === 65536;
	    };

	    Promise.prototype._isCancelled = function () {
	        return this._target().__isCancelled();
	    };

	    Promise.prototype.isCancelled = function () {
	        return (this._target()._bitField & 8454144) !== 0;
	    };

	    Promise.prototype.isPending = function () {
	        return isPending.call(this._target());
	    };

	    Promise.prototype.isRejected = function () {
	        return isRejected.call(this._target());
	    };

	    Promise.prototype.isFulfilled = function () {
	        return isFulfilled.call(this._target());
	    };

	    Promise.prototype.isResolved = function () {
	        return isResolved.call(this._target());
	    };

	    Promise.prototype.value = function () {
	        return value.call(this._target());
	    };

	    Promise.prototype.reason = function () {
	        var target = this._target();
	        target._unsetRejectionIsUnhandled();
	        return reason.call(target);
	    };

	    Promise.prototype._value = function () {
	        return this._settledValue();
	    };

	    Promise.prototype._reason = function () {
	        this._unsetRejectionIsUnhandled();
	        return this._settledValue();
	    };

	    Promise.PromiseInspection = PromiseInspection;
	};

/***/ },
/* 30 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, tryConvertToPromise, INTERNAL, async, getDomain) {
	    var util = __webpack_require__(12);
	    var canEvaluate = util.canEvaluate;
	    var tryCatch = util.tryCatch;
	    var errorObj = util.errorObj;
	    var reject;

	    if (true) {
	        if (canEvaluate) {
	            var thenCallback = function (i) {
	                return new Function("value", "holder", "                             \n\
	            'use strict';                                                    \n\
	            holder.pIndex = value;                                           \n\
	            holder.checkFulfillment(this);                                   \n\
	            ".replace(/Index/g, i));
	            };

	            var promiseSetter = function (i) {
	                return new Function("promise", "holder", "                           \n\
	            'use strict';                                                    \n\
	            holder.pIndex = promise;                                         \n\
	            ".replace(/Index/g, i));
	            };

	            var generateHolderClass = function (total) {
	                var props = new Array(total);
	                for (var i = 0; i < props.length; ++i) {
	                    props[i] = "this.p" + (i + 1);
	                }
	                var assignment = props.join(" = ") + " = null;";
	                var cancellationCode = "var promise;\n" + props.map(function (prop) {
	                    return "                                                         \n\
	                promise = " + prop + ";                                      \n\
	                if (promise instanceof Promise) {                            \n\
	                    promise.cancel();                                        \n\
	                }                                                            \n\
	            ";
	                }).join("\n");
	                var passedArguments = props.join(", ");
	                var name = "Holder$" + total;

	                var code = "return function(tryCatch, errorObj, Promise, async) {    \n\
	            'use strict';                                                    \n\
	            function [TheName](fn) {                                         \n\
	                [TheProperties]                                              \n\
	                this.fn = fn;                                                \n\
	                this.asyncNeeded = true;                                     \n\
	                this.now = 0;                                                \n\
	            }                                                                \n\
	                                                                             \n\
	            [TheName].prototype._callFunction = function(promise) {          \n\
	                promise._pushContext();                                      \n\
	                var ret = tryCatch(this.fn)([ThePassedArguments]);           \n\
	                promise._popContext();                                       \n\
	                if (ret === errorObj) {                                      \n\
	                    promise._rejectCallback(ret.e, false);                   \n\
	                } else {                                                     \n\
	                    promise._resolveCallback(ret);                           \n\
	                }                                                            \n\
	            };                                                               \n\
	                                                                             \n\
	            [TheName].prototype.checkFulfillment = function(promise) {       \n\
	                var now = ++this.now;                                        \n\
	                if (now === [TheTotal]) {                                    \n\
	                    if (this.asyncNeeded) {                                  \n\
	                        async.invoke(this._callFunction, this, promise);     \n\
	                    } else {                                                 \n\
	                        this._callFunction(promise);                         \n\
	                    }                                                        \n\
	                                                                             \n\
	                }                                                            \n\
	            };                                                               \n\
	                                                                             \n\
	            [TheName].prototype._resultCancelled = function() {              \n\
	                [CancellationCode]                                           \n\
	            };                                                               \n\
	                                                                             \n\
	            return [TheName];                                                \n\
	        }(tryCatch, errorObj, Promise, async);                               \n\
	        ";

	                code = code.replace(/\[TheName\]/g, name).replace(/\[TheTotal\]/g, total).replace(/\[ThePassedArguments\]/g, passedArguments).replace(/\[TheProperties\]/g, assignment).replace(/\[CancellationCode\]/g, cancellationCode);

	                return new Function("tryCatch", "errorObj", "Promise", "async", code)(tryCatch, errorObj, Promise, async);
	            };

	            var holderClasses = [];
	            var thenCallbacks = [];
	            var promiseSetters = [];

	            for (var i = 0; i < 8; ++i) {
	                holderClasses.push(generateHolderClass(i + 1));
	                thenCallbacks.push(thenCallback(i + 1));
	                promiseSetters.push(promiseSetter(i + 1));
	            }

	            reject = function (reason) {
	                this._reject(reason);
	            };
	        }
	    }

	    Promise.join = function () {
	        var last = arguments.length - 1;
	        var fn;
	        if (last > 0 && typeof arguments[last] === "function") {
	            fn = arguments[last];
	            if (true) {
	                if (last <= 8 && canEvaluate) {
	                    var ret = new Promise(INTERNAL);
	                    ret._captureStackTrace();
	                    var HolderClass = holderClasses[last - 1];
	                    var holder = new HolderClass(fn);
	                    var callbacks = thenCallbacks;

	                    for (var i = 0; i < last; ++i) {
	                        var maybePromise = tryConvertToPromise(arguments[i], ret);
	                        if (maybePromise instanceof Promise) {
	                            maybePromise = maybePromise._target();
	                            var bitField = maybePromise._bitField;
	                            ;
	                            if ((bitField & 50397184) === 0) {
	                                maybePromise._then(callbacks[i], reject, undefined, ret, holder);
	                                promiseSetters[i](maybePromise, holder);
	                                holder.asyncNeeded = false;
	                            } else if ((bitField & 33554432) !== 0) {
	                                callbacks[i].call(ret, maybePromise._value(), holder);
	                            } else if ((bitField & 16777216) !== 0) {
	                                ret._reject(maybePromise._reason());
	                            } else {
	                                ret._cancel();
	                            }
	                        } else {
	                            callbacks[i].call(ret, maybePromise, holder);
	                        }
	                    }

	                    if (!ret._isFateSealed()) {
	                        if (holder.asyncNeeded) {
	                            var domain = getDomain();
	                            if (domain !== null) {
	                                holder.fn = util.domainBind(domain, holder.fn);
	                            }
	                        }
	                        ret._setAsyncGuaranteed();
	                        ret._setOnCancel(holder);
	                    }
	                    return ret;
	                }
	            }
	        }
	        var $_len = arguments.length;var args = new Array($_len);for (var $_i = 0; $_i < $_len; ++$_i) {
	            args[$_i] = arguments[$_i];
	        };
	        if (fn) args.pop();
	        var ret = new PromiseArray(args).promise();
	        return fn !== undefined ? ret.spread(fn) : ret;
	    };
	};

/***/ },
/* 31 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug) {
	    var getDomain = Promise._getDomain;
	    var util = __webpack_require__(12);
	    var tryCatch = util.tryCatch;
	    var errorObj = util.errorObj;
	    var async = Promise._async;

	    function MappingPromiseArray(promises, fn, limit, _filter) {
	        this.constructor$(promises);
	        this._promise._captureStackTrace();
	        var domain = getDomain();
	        this._callback = domain === null ? fn : util.domainBind(domain, fn);
	        this._preservedValues = _filter === INTERNAL ? new Array(this.length()) : null;
	        this._limit = limit;
	        this._inFlight = 0;
	        this._queue = [];
	        async.invoke(this._asyncInit, this, undefined);
	    }
	    util.inherits(MappingPromiseArray, PromiseArray);

	    MappingPromiseArray.prototype._asyncInit = function () {
	        this._init$(undefined, -2);
	    };

	    MappingPromiseArray.prototype._init = function () {};

	    MappingPromiseArray.prototype._promiseFulfilled = function (value, index) {
	        var values = this._values;
	        var length = this.length();
	        var preservedValues = this._preservedValues;
	        var limit = this._limit;

	        if (index < 0) {
	            index = index * -1 - 1;
	            values[index] = value;
	            if (limit >= 1) {
	                this._inFlight--;
	                this._drainQueue();
	                if (this._isResolved()) return true;
	            }
	        } else {
	            if (limit >= 1 && this._inFlight >= limit) {
	                values[index] = value;
	                this._queue.push(index);
	                return false;
	            }
	            if (preservedValues !== null) preservedValues[index] = value;

	            var promise = this._promise;
	            var callback = this._callback;
	            var receiver = promise._boundValue();
	            promise._pushContext();
	            var ret = tryCatch(callback).call(receiver, value, index, length);
	            var promiseCreated = promise._popContext();
	            debug.checkForgottenReturns(ret, promiseCreated, preservedValues !== null ? "Promise.filter" : "Promise.map", promise);
	            if (ret === errorObj) {
	                this._reject(ret.e);
	                return true;
	            }

	            var maybePromise = tryConvertToPromise(ret, this._promise);
	            if (maybePromise instanceof Promise) {
	                maybePromise = maybePromise._target();
	                var bitField = maybePromise._bitField;
	                ;
	                if ((bitField & 50397184) === 0) {
	                    if (limit >= 1) this._inFlight++;
	                    values[index] = maybePromise;
	                    maybePromise._proxy(this, (index + 1) * -1);
	                    return false;
	                } else if ((bitField & 33554432) !== 0) {
	                    ret = maybePromise._value();
	                } else if ((bitField & 16777216) !== 0) {
	                    this._reject(maybePromise._reason());
	                    return true;
	                } else {
	                    this._cancel();
	                    return true;
	                }
	            }
	            values[index] = ret;
	        }
	        var totalResolved = ++this._totalResolved;
	        if (totalResolved >= length) {
	            if (preservedValues !== null) {
	                this._filter(values, preservedValues);
	            } else {
	                this._resolve(values);
	            }
	            return true;
	        }
	        return false;
	    };

	    MappingPromiseArray.prototype._drainQueue = function () {
	        var queue = this._queue;
	        var limit = this._limit;
	        var values = this._values;
	        while (queue.length > 0 && this._inFlight < limit) {
	            if (this._isResolved()) return;
	            var index = queue.pop();
	            this._promiseFulfilled(values[index], index);
	        }
	    };

	    MappingPromiseArray.prototype._filter = function (booleans, values) {
	        var len = values.length;
	        var ret = new Array(len);
	        var j = 0;
	        for (var i = 0; i < len; ++i) {
	            if (booleans[i]) ret[j++] = values[i];
	        }
	        ret.length = j;
	        this._resolve(ret);
	    };

	    MappingPromiseArray.prototype.preservedValues = function () {
	        return this._preservedValues;
	    };

	    function map(promises, fn, options, _filter) {
	        if (typeof fn !== "function") {
	            return apiRejection("expecting a function but got " + util.classString(fn));
	        }

	        var limit = 0;
	        if (options !== undefined) {
	            if (typeof options === "object" && options !== null) {
	                if (typeof options.concurrency !== "number") {
	                    return Promise.reject(new TypeError("'concurrency' must be a number but it is " + util.classString(options.concurrency)));
	                }
	                limit = options.concurrency;
	            } else {
	                return Promise.reject(new TypeError("options argument must be an object but it is " + util.classString(options)));
	            }
	        }
	        limit = typeof limit === "number" && isFinite(limit) && limit >= 1 ? limit : 0;
	        return new MappingPromiseArray(promises, fn, limit, _filter).promise();
	    }

	    Promise.prototype.map = function (fn, options) {
	        return map(this, fn, options, null);
	    };

	    Promise.map = function (promises, fn, options, _filter) {
	        return map(promises, fn, options, _filter);
	    };
	};

/***/ },
/* 32 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	var cr = Object.create;
	if (cr) {
	    var callerCache = cr(null);
	    var getterCache = cr(null);
	    callerCache[" size"] = getterCache[" size"] = 0;
	}

	module.exports = function (Promise) {
	    var util = __webpack_require__(12);
	    var canEvaluate = util.canEvaluate;
	    var isIdentifier = util.isIdentifier;

	    var getMethodCaller;
	    var getGetter;
	    if (true) {
	        var makeMethodCaller = function (methodName) {
	            return new Function("ensureMethod", "                                    \n\
	        return function(obj) {                                               \n\
	            'use strict'                                                     \n\
	            var len = this.length;                                           \n\
	            ensureMethod(obj, 'methodName');                                 \n\
	            switch(len) {                                                    \n\
	                case 1: return obj.methodName(this[0]);                      \n\
	                case 2: return obj.methodName(this[0], this[1]);             \n\
	                case 3: return obj.methodName(this[0], this[1], this[2]);    \n\
	                case 0: return obj.methodName();                             \n\
	                default:                                                     \n\
	                    return obj.methodName.apply(obj, this);                  \n\
	            }                                                                \n\
	        };                                                                   \n\
	        ".replace(/methodName/g, methodName))(ensureMethod);
	        };

	        var makeGetter = function (propertyName) {
	            return new Function("obj", "                                             \n\
	        'use strict';                                                        \n\
	        return obj.propertyName;                                             \n\
	        ".replace("propertyName", propertyName));
	        };

	        var getCompiled = function (name, compiler, cache) {
	            var ret = cache[name];
	            if (typeof ret !== "function") {
	                if (!isIdentifier(name)) {
	                    return null;
	                }
	                ret = compiler(name);
	                cache[name] = ret;
	                cache[" size"]++;
	                if (cache[" size"] > 512) {
	                    var keys = Object.keys(cache);
	                    for (var i = 0; i < 256; ++i) delete cache[keys[i]];
	                    cache[" size"] = keys.length - 256;
	                }
	            }
	            return ret;
	        };

	        getMethodCaller = function (name) {
	            return getCompiled(name, makeMethodCaller, callerCache);
	        };

	        getGetter = function (name) {
	            return getCompiled(name, makeGetter, getterCache);
	        };
	    }

	    function ensureMethod(obj, methodName) {
	        var fn;
	        if (obj != null) fn = obj[methodName];
	        if (typeof fn !== "function") {
	            var message = "Object " + util.classString(obj) + " has no method '" + util.toString(methodName) + "'";
	            throw new Promise.TypeError(message);
	        }
	        return fn;
	    }

	    function caller(obj) {
	        var methodName = this.pop();
	        var fn = ensureMethod(obj, methodName);
	        return fn.apply(obj, this);
	    }
	    Promise.prototype.call = function (methodName) {
	        var $_len = arguments.length;var args = new Array(Math.max($_len - 1, 0));for (var $_i = 1; $_i < $_len; ++$_i) {
	            args[$_i - 1] = arguments[$_i];
	        };
	        if (true) {
	            if (canEvaluate) {
	                var maybeCaller = getMethodCaller(methodName);
	                if (maybeCaller !== null) {
	                    return this._then(maybeCaller, undefined, undefined, args, undefined);
	                }
	            }
	        }
	        args.push(methodName);
	        return this._then(caller, undefined, undefined, args, undefined);
	    };

	    function namedGetter(obj) {
	        return obj[this];
	    }
	    function indexedGetter(obj) {
	        var index = +this;
	        if (index < 0) index = Math.max(0, index + obj.length);
	        return obj[index];
	    }
	    Promise.prototype.get = function (propertyName) {
	        var isIndex = typeof propertyName === "number";
	        var getter;
	        if (!isIndex) {
	            if (canEvaluate) {
	                var maybeGetter = getGetter(propertyName);
	                getter = maybeGetter !== null ? maybeGetter : namedGetter;
	            } else {
	                getter = namedGetter;
	            }
	        } else {
	            getter = indexedGetter;
	        }
	        return this._then(getter, undefined, undefined, propertyName, undefined);
	    };
	};

/***/ },
/* 33 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, apiRejection, tryConvertToPromise, createContext, INTERNAL, debug) {
	    var util = __webpack_require__(12);
	    var TypeError = __webpack_require__(17).TypeError;
	    var inherits = __webpack_require__(12).inherits;
	    var errorObj = util.errorObj;
	    var tryCatch = util.tryCatch;
	    var NULL = {};

	    function thrower(e) {
	        setTimeout(function () {
	            throw e;
	        }, 0);
	    }

	    function castPreservingDisposable(thenable) {
	        var maybePromise = tryConvertToPromise(thenable);
	        if (maybePromise !== thenable && typeof thenable._isDisposable === "function" && typeof thenable._getDisposer === "function" && thenable._isDisposable()) {
	            maybePromise._setDisposable(thenable._getDisposer());
	        }
	        return maybePromise;
	    }
	    function dispose(resources, inspection) {
	        var i = 0;
	        var len = resources.length;
	        var ret = new Promise(INTERNAL);
	        function iterator() {
	            if (i >= len) return ret._fulfill();
	            var maybePromise = castPreservingDisposable(resources[i++]);
	            if (maybePromise instanceof Promise && maybePromise._isDisposable()) {
	                try {
	                    maybePromise = tryConvertToPromise(maybePromise._getDisposer().tryDispose(inspection), resources.promise);
	                } catch (e) {
	                    return thrower(e);
	                }
	                if (maybePromise instanceof Promise) {
	                    return maybePromise._then(iterator, thrower, null, null, null);
	                }
	            }
	            iterator();
	        }
	        iterator();
	        return ret;
	    }

	    function Disposer(data, promise, context) {
	        this._data = data;
	        this._promise = promise;
	        this._context = context;
	    }

	    Disposer.prototype.data = function () {
	        return this._data;
	    };

	    Disposer.prototype.promise = function () {
	        return this._promise;
	    };

	    Disposer.prototype.resource = function () {
	        if (this.promise().isFulfilled()) {
	            return this.promise().value();
	        }
	        return NULL;
	    };

	    Disposer.prototype.tryDispose = function (inspection) {
	        var resource = this.resource();
	        var context = this._context;
	        if (context !== undefined) context._pushContext();
	        var ret = resource !== NULL ? this.doDispose(resource, inspection) : null;
	        if (context !== undefined) context._popContext();
	        this._promise._unsetDisposable();
	        this._data = null;
	        return ret;
	    };

	    Disposer.isDisposer = function (d) {
	        return d != null && typeof d.resource === "function" && typeof d.tryDispose === "function";
	    };

	    function FunctionDisposer(fn, promise, context) {
	        this.constructor$(fn, promise, context);
	    }
	    inherits(FunctionDisposer, Disposer);

	    FunctionDisposer.prototype.doDispose = function (resource, inspection) {
	        var fn = this.data();
	        return fn.call(resource, resource, inspection);
	    };

	    function maybeUnwrapDisposer(value) {
	        if (Disposer.isDisposer(value)) {
	            this.resources[this.index]._setDisposable(value);
	            return value.promise();
	        }
	        return value;
	    }

	    function ResourceList(length) {
	        this.length = length;
	        this.promise = null;
	        this[length - 1] = null;
	    }

	    ResourceList.prototype._resultCancelled = function () {
	        var len = this.length;
	        for (var i = 0; i < len; ++i) {
	            var item = this[i];
	            if (item instanceof Promise) {
	                item.cancel();
	            }
	        }
	    };

	    Promise.using = function () {
	        var len = arguments.length;
	        if (len < 2) return apiRejection("you must pass at least 2 arguments to Promise.using");
	        var fn = arguments[len - 1];
	        if (typeof fn !== "function") {
	            return apiRejection("expecting a function but got " + util.classString(fn));
	        }
	        var input;
	        var spreadArgs = true;
	        if (len === 2 && Array.isArray(arguments[0])) {
	            input = arguments[0];
	            len = input.length;
	            spreadArgs = false;
	        } else {
	            input = arguments;
	            len--;
	        }
	        var resources = new ResourceList(len);
	        for (var i = 0; i < len; ++i) {
	            var resource = input[i];
	            if (Disposer.isDisposer(resource)) {
	                var disposer = resource;
	                resource = resource.promise();
	                resource._setDisposable(disposer);
	            } else {
	                var maybePromise = tryConvertToPromise(resource);
	                if (maybePromise instanceof Promise) {
	                    resource = maybePromise._then(maybeUnwrapDisposer, null, null, {
	                        resources: resources,
	                        index: i
	                    }, undefined);
	                }
	            }
	            resources[i] = resource;
	        }

	        var reflectedResources = new Array(resources.length);
	        for (var i = 0; i < reflectedResources.length; ++i) {
	            reflectedResources[i] = Promise.resolve(resources[i]).reflect();
	        }

	        var resultPromise = Promise.all(reflectedResources).then(function (inspections) {
	            for (var i = 0; i < inspections.length; ++i) {
	                var inspection = inspections[i];
	                if (inspection.isRejected()) {
	                    errorObj.e = inspection.error();
	                    return errorObj;
	                } else if (!inspection.isFulfilled()) {
	                    resultPromise.cancel();
	                    return;
	                }
	                inspections[i] = inspection.value();
	            }
	            promise._pushContext();

	            fn = tryCatch(fn);
	            var ret = spreadArgs ? fn.apply(undefined, inspections) : fn(inspections);
	            var promiseCreated = promise._popContext();
	            debug.checkForgottenReturns(ret, promiseCreated, "Promise.using", promise);
	            return ret;
	        });

	        var promise = resultPromise.lastly(function () {
	            var inspection = new Promise.PromiseInspection(resultPromise);
	            return dispose(resources, inspection);
	        });
	        resources.promise = promise;
	        promise._setOnCancel(resources);
	        return promise;
	    };

	    Promise.prototype._setDisposable = function (disposer) {
	        this._bitField = this._bitField | 131072;
	        this._disposer = disposer;
	    };

	    Promise.prototype._isDisposable = function () {
	        return (this._bitField & 131072) > 0;
	    };

	    Promise.prototype._getDisposer = function () {
	        return this._disposer;
	    };

	    Promise.prototype._unsetDisposable = function () {
	        this._bitField = this._bitField & ~131072;
	        this._disposer = undefined;
	    };

	    Promise.prototype.disposer = function (fn) {
	        if (typeof fn === "function") {
	            return new FunctionDisposer(fn, this, createContext());
	        }
	        throw new TypeError();
	    };
	};

/***/ },
/* 34 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, INTERNAL, debug) {
	    var util = __webpack_require__(12);
	    var TimeoutError = Promise.TimeoutError;

	    function HandleWrapper(handle) {
	        this.handle = handle;
	    }

	    HandleWrapper.prototype._resultCancelled = function () {
	        clearTimeout(this.handle);
	    };

	    var afterValue = function (value) {
	        return delay(+this).thenReturn(value);
	    };
	    var delay = Promise.delay = function (ms, value) {
	        var ret;
	        var handle;
	        if (value !== undefined) {
	            ret = Promise.resolve(value)._then(afterValue, null, null, ms, undefined);
	            if (debug.cancellation() && value instanceof Promise) {
	                ret._setOnCancel(value);
	            }
	        } else {
	            ret = new Promise(INTERNAL);
	            handle = setTimeout(function () {
	                ret._fulfill();
	            }, +ms);
	            if (debug.cancellation()) {
	                ret._setOnCancel(new HandleWrapper(handle));
	            }
	            ret._captureStackTrace();
	        }
	        ret._setAsyncGuaranteed();
	        return ret;
	    };

	    Promise.prototype.delay = function (ms) {
	        return delay(ms, this);
	    };

	    var afterTimeout = function (promise, message, parent) {
	        var err;
	        if (typeof message !== "string") {
	            if (message instanceof Error) {
	                err = message;
	            } else {
	                err = new TimeoutError("operation timed out");
	            }
	        } else {
	            err = new TimeoutError(message);
	        }
	        util.markAsOriginatingFromRejection(err);
	        promise._attachExtraTrace(err);
	        promise._reject(err);

	        if (parent != null) {
	            parent.cancel();
	        }
	    };

	    function successClear(value) {
	        clearTimeout(this.handle);
	        return value;
	    }

	    function failureClear(reason) {
	        clearTimeout(this.handle);
	        throw reason;
	    }

	    Promise.prototype.timeout = function (ms, message) {
	        ms = +ms;
	        var ret, parent;

	        var handleWrapper = new HandleWrapper(setTimeout(function timeoutTimeout() {
	            if (ret.isPending()) {
	                afterTimeout(ret, message, parent);
	            }
	        }, ms));

	        if (debug.cancellation()) {
	            parent = this.then();
	            ret = parent._then(successClear, failureClear, undefined, handleWrapper, undefined);
	            ret._setOnCancel(handleWrapper);
	        } else {
	            ret = this._then(successClear, failureClear, undefined, handleWrapper, undefined);
	        }

	        return ret;
	    };
	};

/***/ },
/* 35 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, apiRejection, INTERNAL, tryConvertToPromise, Proxyable, debug) {
	    var errors = __webpack_require__(17);
	    var TypeError = errors.TypeError;
	    var util = __webpack_require__(12);
	    var errorObj = util.errorObj;
	    var tryCatch = util.tryCatch;
	    var yieldHandlers = [];

	    function promiseFromYieldHandler(value, yieldHandlers, traceParent) {
	        for (var i = 0; i < yieldHandlers.length; ++i) {
	            traceParent._pushContext();
	            var result = tryCatch(yieldHandlers[i])(value);
	            traceParent._popContext();
	            if (result === errorObj) {
	                traceParent._pushContext();
	                var ret = Promise.reject(errorObj.e);
	                traceParent._popContext();
	                return ret;
	            }
	            var maybePromise = tryConvertToPromise(result, traceParent);
	            if (maybePromise instanceof Promise) return maybePromise;
	        }
	        return null;
	    }

	    function PromiseSpawn(generatorFunction, receiver, yieldHandler, stack) {
	        if (debug.cancellation()) {
	            var internal = new Promise(INTERNAL);
	            var _finallyPromise = this._finallyPromise = new Promise(INTERNAL);
	            this._promise = internal.lastly(function () {
	                return _finallyPromise;
	            });
	            internal._captureStackTrace();
	            internal._setOnCancel(this);
	        } else {
	            var promise = this._promise = new Promise(INTERNAL);
	            promise._captureStackTrace();
	        }
	        this._stack = stack;
	        this._generatorFunction = generatorFunction;
	        this._receiver = receiver;
	        this._generator = undefined;
	        this._yieldHandlers = typeof yieldHandler === "function" ? [yieldHandler].concat(yieldHandlers) : yieldHandlers;
	        this._yieldedPromise = null;
	        this._cancellationPhase = false;
	    }
	    util.inherits(PromiseSpawn, Proxyable);

	    PromiseSpawn.prototype._isResolved = function () {
	        return this._promise === null;
	    };

	    PromiseSpawn.prototype._cleanup = function () {
	        this._promise = this._generator = null;
	        if (debug.cancellation() && this._finallyPromise !== null) {
	            this._finallyPromise._fulfill();
	            this._finallyPromise = null;
	        }
	    };

	    PromiseSpawn.prototype._promiseCancelled = function () {
	        if (this._isResolved()) return;
	        var implementsReturn = typeof this._generator["return"] !== "undefined";

	        var result;
	        if (!implementsReturn) {
	            var reason = new Promise.CancellationError("generator .return() sentinel");
	            Promise.coroutine.returnSentinel = reason;
	            this._promise._attachExtraTrace(reason);
	            this._promise._pushContext();
	            result = tryCatch(this._generator["throw"]).call(this._generator, reason);
	            this._promise._popContext();
	        } else {
	            this._promise._pushContext();
	            result = tryCatch(this._generator["return"]).call(this._generator, undefined);
	            this._promise._popContext();
	        }
	        this._cancellationPhase = true;
	        this._yieldedPromise = null;
	        this._continue(result);
	    };

	    PromiseSpawn.prototype._promiseFulfilled = function (value) {
	        this._yieldedPromise = null;
	        this._promise._pushContext();
	        var result = tryCatch(this._generator.next).call(this._generator, value);
	        this._promise._popContext();
	        this._continue(result);
	    };

	    PromiseSpawn.prototype._promiseRejected = function (reason) {
	        this._yieldedPromise = null;
	        this._promise._attachExtraTrace(reason);
	        this._promise._pushContext();
	        var result = tryCatch(this._generator["throw"]).call(this._generator, reason);
	        this._promise._popContext();
	        this._continue(result);
	    };

	    PromiseSpawn.prototype._resultCancelled = function () {
	        if (this._yieldedPromise instanceof Promise) {
	            var promise = this._yieldedPromise;
	            this._yieldedPromise = null;
	            promise.cancel();
	        }
	    };

	    PromiseSpawn.prototype.promise = function () {
	        return this._promise;
	    };

	    PromiseSpawn.prototype._run = function () {
	        this._generator = this._generatorFunction.call(this._receiver);
	        this._receiver = this._generatorFunction = undefined;
	        this._promiseFulfilled(undefined);
	    };

	    PromiseSpawn.prototype._continue = function (result) {
	        var promise = this._promise;
	        if (result === errorObj) {
	            this._cleanup();
	            if (this._cancellationPhase) {
	                return promise.cancel();
	            } else {
	                return promise._rejectCallback(result.e, false);
	            }
	        }

	        var value = result.value;
	        if (result.done === true) {
	            this._cleanup();
	            if (this._cancellationPhase) {
	                return promise.cancel();
	            } else {
	                return promise._resolveCallback(value);
	            }
	        } else {
	            var maybePromise = tryConvertToPromise(value, this._promise);
	            if (!(maybePromise instanceof Promise)) {
	                maybePromise = promiseFromYieldHandler(maybePromise, this._yieldHandlers, this._promise);
	                if (maybePromise === null) {
	                    this._promiseRejected(new TypeError("A value %s was yielded that could not be treated as a promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a\u000a".replace("%s", value) + "From coroutine:\u000a" + this._stack.split("\n").slice(1, -7).join("\n")));
	                    return;
	                }
	            }
	            maybePromise = maybePromise._target();
	            var bitField = maybePromise._bitField;
	            ;
	            if ((bitField & 50397184) === 0) {
	                this._yieldedPromise = maybePromise;
	                maybePromise._proxy(this, null);
	            } else if ((bitField & 33554432) !== 0) {
	                Promise._async.invoke(this._promiseFulfilled, this, maybePromise._value());
	            } else if ((bitField & 16777216) !== 0) {
	                Promise._async.invoke(this._promiseRejected, this, maybePromise._reason());
	            } else {
	                this._promiseCancelled();
	            }
	        }
	    };

	    Promise.coroutine = function (generatorFunction, options) {
	        if (typeof generatorFunction !== "function") {
	            throw new TypeError("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        var yieldHandler = Object(options).yieldHandler;
	        var PromiseSpawn$ = PromiseSpawn;
	        var stack = new Error().stack;
	        return function () {
	            var generator = generatorFunction.apply(this, arguments);
	            var spawn = new PromiseSpawn$(undefined, undefined, yieldHandler, stack);
	            var ret = spawn.promise();
	            spawn._generator = generator;
	            spawn._promiseFulfilled(undefined);
	            return ret;
	        };
	    };

	    Promise.coroutine.addYieldHandler = function (fn) {
	        if (typeof fn !== "function") {
	            throw new TypeError("expecting a function but got " + util.classString(fn));
	        }
	        yieldHandlers.push(fn);
	    };

	    Promise.spawn = function (generatorFunction) {
	        debug.deprecated("Promise.spawn()", "Promise.coroutine()");
	        if (typeof generatorFunction !== "function") {
	            return apiRejection("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        var spawn = new PromiseSpawn(generatorFunction, this);
	        var ret = spawn.promise();
	        spawn._run(Promise.spawn);
	        return ret;
	    };
	};

/***/ },
/* 36 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise) {
	    var util = __webpack_require__(12);
	    var async = Promise._async;
	    var tryCatch = util.tryCatch;
	    var errorObj = util.errorObj;

	    function spreadAdapter(val, nodeback) {
	        var promise = this;
	        if (!util.isArray(val)) return successAdapter.call(promise, val, nodeback);
	        var ret = tryCatch(nodeback).apply(promise._boundValue(), [null].concat(val));
	        if (ret === errorObj) {
	            async.throwLater(ret.e);
	        }
	    }

	    function successAdapter(val, nodeback) {
	        var promise = this;
	        var receiver = promise._boundValue();
	        var ret = val === undefined ? tryCatch(nodeback).call(receiver, null) : tryCatch(nodeback).call(receiver, null, val);
	        if (ret === errorObj) {
	            async.throwLater(ret.e);
	        }
	    }
	    function errorAdapter(reason, nodeback) {
	        var promise = this;
	        if (!reason) {
	            var newReason = new Error(reason + "");
	            newReason.cause = reason;
	            reason = newReason;
	        }
	        var ret = tryCatch(nodeback).call(promise._boundValue(), reason);
	        if (ret === errorObj) {
	            async.throwLater(ret.e);
	        }
	    }

	    Promise.prototype.asCallback = Promise.prototype.nodeify = function (nodeback, options) {
	        if (typeof nodeback == "function") {
	            var adapter = successAdapter;
	            if (options !== undefined && Object(options).spread) {
	                adapter = spreadAdapter;
	            }
	            this._then(adapter, errorAdapter, undefined, this, nodeback);
	        }
	        return this;
	    };
	};

/***/ },
/* 37 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, INTERNAL) {
	    var THIS = {};
	    var util = __webpack_require__(12);
	    var nodebackForPromise = __webpack_require__(24);
	    var withAppended = util.withAppended;
	    var maybeWrapAsError = util.maybeWrapAsError;
	    var canEvaluate = util.canEvaluate;
	    var TypeError = __webpack_require__(17).TypeError;
	    var defaultSuffix = "Async";
	    var defaultPromisified = { __isPromisified__: true };
	    var noCopyProps = ["arity", "length", "name", "arguments", "caller", "callee", "prototype", "__isPromisified__"];
	    var noCopyPropsPattern = new RegExp("^(?:" + noCopyProps.join("|") + ")$");

	    var defaultFilter = function (name) {
	        return util.isIdentifier(name) && name.charAt(0) !== "_" && name !== "constructor";
	    };

	    function propsFilter(key) {
	        return !noCopyPropsPattern.test(key);
	    }

	    function isPromisified(fn) {
	        try {
	            return fn.__isPromisified__ === true;
	        } catch (e) {
	            return false;
	        }
	    }

	    function hasPromisified(obj, key, suffix) {
	        var val = util.getDataPropertyOrDefault(obj, key + suffix, defaultPromisified);
	        return val ? isPromisified(val) : false;
	    }
	    function checkValid(ret, suffix, suffixRegexp) {
	        for (var i = 0; i < ret.length; i += 2) {
	            var key = ret[i];
	            if (suffixRegexp.test(key)) {
	                var keyWithoutAsyncSuffix = key.replace(suffixRegexp, "");
	                for (var j = 0; j < ret.length; j += 2) {
	                    if (ret[j] === keyWithoutAsyncSuffix) {
	                        throw new TypeError("Cannot promisify an API that has normal methods with '%s'-suffix\u000a\u000a    See http://goo.gl/MqrFmX\u000a".replace("%s", suffix));
	                    }
	                }
	            }
	        }
	    }

	    function promisifiableMethods(obj, suffix, suffixRegexp, filter) {
	        var keys = util.inheritedDataKeys(obj);
	        var ret = [];
	        for (var i = 0; i < keys.length; ++i) {
	            var key = keys[i];
	            var value = obj[key];
	            var passesDefaultFilter = filter === defaultFilter ? true : defaultFilter(key, value, obj);
	            if (typeof value === "function" && !isPromisified(value) && !hasPromisified(obj, key, suffix) && filter(key, value, obj, passesDefaultFilter)) {
	                ret.push(key, value);
	            }
	        }
	        checkValid(ret, suffix, suffixRegexp);
	        return ret;
	    }

	    var escapeIdentRegex = function (str) {
	        return str.replace(/([$])/, "\\$");
	    };

	    var makeNodePromisifiedEval;
	    if (true) {
	        var switchCaseArgumentOrder = function (likelyArgumentCount) {
	            var ret = [likelyArgumentCount];
	            var min = Math.max(0, likelyArgumentCount - 1 - 3);
	            for (var i = likelyArgumentCount - 1; i >= min; --i) {
	                ret.push(i);
	            }
	            for (var i = likelyArgumentCount + 1; i <= 3; ++i) {
	                ret.push(i);
	            }
	            return ret;
	        };

	        var argumentSequence = function (argumentCount) {
	            return util.filledRange(argumentCount, "_arg", "");
	        };

	        var parameterDeclaration = function (parameterCount) {
	            return util.filledRange(Math.max(parameterCount, 3), "_arg", "");
	        };

	        var parameterCount = function (fn) {
	            if (typeof fn.length === "number") {
	                return Math.max(Math.min(fn.length, 1023 + 1), 0);
	            }
	            return 0;
	        };

	        makeNodePromisifiedEval = function (callback, receiver, originalName, fn, _, multiArgs) {
	            var newParameterCount = Math.max(0, parameterCount(fn) - 1);
	            var argumentOrder = switchCaseArgumentOrder(newParameterCount);
	            var shouldProxyThis = typeof callback === "string" || receiver === THIS;

	            function generateCallForArgumentCount(count) {
	                var args = argumentSequence(count).join(", ");
	                var comma = count > 0 ? ", " : "";
	                var ret;
	                if (shouldProxyThis) {
	                    ret = "ret = callback.call(this, {{args}}, nodeback); break;\n";
	                } else {
	                    ret = receiver === undefined ? "ret = callback({{args}}, nodeback); break;\n" : "ret = callback.call(receiver, {{args}}, nodeback); break;\n";
	                }
	                return ret.replace("{{args}}", args).replace(", ", comma);
	            }

	            function generateArgumentSwitchCase() {
	                var ret = "";
	                for (var i = 0; i < argumentOrder.length; ++i) {
	                    ret += "case " + argumentOrder[i] + ":" + generateCallForArgumentCount(argumentOrder[i]);
	                }

	                ret += "                                                             \n\
	        default:                                                             \n\
	            var args = new Array(len + 1);                                   \n\
	            var i = 0;                                                       \n\
	            for (var i = 0; i < len; ++i) {                                  \n\
	               args[i] = arguments[i];                                       \n\
	            }                                                                \n\
	            args[i] = nodeback;                                              \n\
	            [CodeForCall]                                                    \n\
	            break;                                                           \n\
	        ".replace("[CodeForCall]", shouldProxyThis ? "ret = callback.apply(this, args);\n" : "ret = callback.apply(receiver, args);\n");
	                return ret;
	            }

	            var getFunctionCode = typeof callback === "string" ? "this != null ? this['" + callback + "'] : fn" : "fn";
	            var body = "'use strict';                                                \n\
	        var ret = function (Parameters) {                                    \n\
	            'use strict';                                                    \n\
	            var len = arguments.length;                                      \n\
	            var promise = new Promise(INTERNAL);                             \n\
	            promise._captureStackTrace();                                    \n\
	            var nodeback = nodebackForPromise(promise, " + multiArgs + ");   \n\
	            var ret;                                                         \n\
	            var callback = tryCatch([GetFunctionCode]);                      \n\
	            switch(len) {                                                    \n\
	                [CodeForSwitchCase]                                          \n\
	            }                                                                \n\
	            if (ret === errorObj) {                                          \n\
	                promise._rejectCallback(maybeWrapAsError(ret.e), true, true);\n\
	            }                                                                \n\
	            if (!promise._isFateSealed()) promise._setAsyncGuaranteed();     \n\
	            return promise;                                                  \n\
	        };                                                                   \n\
	        notEnumerableProp(ret, '__isPromisified__', true);                   \n\
	        return ret;                                                          \n\
	    ".replace("[CodeForSwitchCase]", generateArgumentSwitchCase()).replace("[GetFunctionCode]", getFunctionCode);
	            body = body.replace("Parameters", parameterDeclaration(newParameterCount));
	            return new Function("Promise", "fn", "receiver", "withAppended", "maybeWrapAsError", "nodebackForPromise", "tryCatch", "errorObj", "notEnumerableProp", "INTERNAL", body)(Promise, fn, receiver, withAppended, maybeWrapAsError, nodebackForPromise, util.tryCatch, util.errorObj, util.notEnumerableProp, INTERNAL);
	        };
	    }

	    function makeNodePromisifiedClosure(callback, receiver, _, fn, __, multiArgs) {
	        var defaultThis = function () {
	            return this;
	        }();
	        var method = callback;
	        if (typeof method === "string") {
	            callback = fn;
	        }
	        function promisified() {
	            var _receiver = receiver;
	            if (receiver === THIS) _receiver = this;
	            var promise = new Promise(INTERNAL);
	            promise._captureStackTrace();
	            var cb = typeof method === "string" && this !== defaultThis ? this[method] : callback;
	            var fn = nodebackForPromise(promise, multiArgs);
	            try {
	                cb.apply(_receiver, withAppended(arguments, fn));
	            } catch (e) {
	                promise._rejectCallback(maybeWrapAsError(e), true, true);
	            }
	            if (!promise._isFateSealed()) promise._setAsyncGuaranteed();
	            return promise;
	        }
	        util.notEnumerableProp(promisified, "__isPromisified__", true);
	        return promisified;
	    }

	    var makeNodePromisified = canEvaluate ? makeNodePromisifiedEval : makeNodePromisifiedClosure;

	    function promisifyAll(obj, suffix, filter, promisifier, multiArgs) {
	        var suffixRegexp = new RegExp(escapeIdentRegex(suffix) + "$");
	        var methods = promisifiableMethods(obj, suffix, suffixRegexp, filter);

	        for (var i = 0, len = methods.length; i < len; i += 2) {
	            var key = methods[i];
	            var fn = methods[i + 1];
	            var promisifiedKey = key + suffix;
	            if (promisifier === makeNodePromisified) {
	                obj[promisifiedKey] = makeNodePromisified(key, THIS, key, fn, suffix, multiArgs);
	            } else {
	                var promisified = promisifier(fn, function () {
	                    return makeNodePromisified(key, THIS, key, fn, suffix, multiArgs);
	                });
	                util.notEnumerableProp(promisified, "__isPromisified__", true);
	                obj[promisifiedKey] = promisified;
	            }
	        }
	        util.toFastProperties(obj);
	        return obj;
	    }

	    function promisify(callback, receiver, multiArgs) {
	        return makeNodePromisified(callback, receiver, undefined, callback, null, multiArgs);
	    }

	    Promise.promisify = function (fn, options) {
	        if (typeof fn !== "function") {
	            throw new TypeError("expecting a function but got " + util.classString(fn));
	        }
	        if (isPromisified(fn)) {
	            return fn;
	        }
	        options = Object(options);
	        var receiver = options.context === undefined ? THIS : options.context;
	        var multiArgs = !!options.multiArgs;
	        var ret = promisify(fn, receiver, multiArgs);
	        util.copyDescriptors(fn, ret, propsFilter);
	        return ret;
	    };

	    Promise.promisifyAll = function (target, options) {
	        if (typeof target !== "function" && typeof target !== "object") {
	            throw new TypeError("the target of promisifyAll must be an object or a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        options = Object(options);
	        var multiArgs = !!options.multiArgs;
	        var suffix = options.suffix;
	        if (typeof suffix !== "string") suffix = defaultSuffix;
	        var filter = options.filter;
	        if (typeof filter !== "function") filter = defaultFilter;
	        var promisifier = options.promisifier;
	        if (typeof promisifier !== "function") promisifier = makeNodePromisified;

	        if (!util.isIdentifier(suffix)) {
	            throw new RangeError("suffix must be a valid identifier\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }

	        var keys = util.inheritedDataKeys(target);
	        for (var i = 0; i < keys.length; ++i) {
	            var value = target[keys[i]];
	            if (keys[i] !== "constructor" && util.isClass(value)) {
	                promisifyAll(value.prototype, suffix, filter, promisifier, multiArgs);
	                promisifyAll(value, suffix, filter, promisifier, multiArgs);
	            }
	        }

	        return promisifyAll(target, suffix, filter, promisifier, multiArgs);
	    };
	};

/***/ },
/* 38 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, tryConvertToPromise, apiRejection) {
	    var util = __webpack_require__(12);
	    var isObject = util.isObject;
	    var es5 = __webpack_require__(13);
	    var Es6Map;
	    if (typeof Map === "function") Es6Map = Map;

	    var mapToEntries = function () {
	        var index = 0;
	        var size = 0;

	        function extractEntry(value, key) {
	            this[index] = value;
	            this[index + size] = key;
	            index++;
	        }

	        return function mapToEntries(map) {
	            size = map.size;
	            index = 0;
	            var ret = new Array(map.size * 2);
	            map.forEach(extractEntry, ret);
	            return ret;
	        };
	    }();

	    var entriesToMap = function (entries) {
	        var ret = new Es6Map();
	        var length = entries.length / 2 | 0;
	        for (var i = 0; i < length; ++i) {
	            var key = entries[length + i];
	            var value = entries[i];
	            ret.set(key, value);
	        }
	        return ret;
	    };

	    function PropertiesPromiseArray(obj) {
	        var isMap = false;
	        var entries;
	        if (Es6Map !== undefined && obj instanceof Es6Map) {
	            entries = mapToEntries(obj);
	            isMap = true;
	        } else {
	            var keys = es5.keys(obj);
	            var len = keys.length;
	            entries = new Array(len * 2);
	            for (var i = 0; i < len; ++i) {
	                var key = keys[i];
	                entries[i] = obj[key];
	                entries[i + len] = key;
	            }
	        }
	        this.constructor$(entries);
	        this._isMap = isMap;
	        this._init$(undefined, -3);
	    }
	    util.inherits(PropertiesPromiseArray, PromiseArray);

	    PropertiesPromiseArray.prototype._init = function () {};

	    PropertiesPromiseArray.prototype._promiseFulfilled = function (value, index) {
	        this._values[index] = value;
	        var totalResolved = ++this._totalResolved;
	        if (totalResolved >= this._length) {
	            var val;
	            if (this._isMap) {
	                val = entriesToMap(this._values);
	            } else {
	                val = {};
	                var keyOffset = this.length();
	                for (var i = 0, len = this.length(); i < len; ++i) {
	                    val[this._values[i + keyOffset]] = this._values[i];
	                }
	            }
	            this._resolve(val);
	            return true;
	        }
	        return false;
	    };

	    PropertiesPromiseArray.prototype.shouldCopyValues = function () {
	        return false;
	    };

	    PropertiesPromiseArray.prototype.getActualLength = function (len) {
	        return len >> 1;
	    };

	    function props(promises) {
	        var ret;
	        var castValue = tryConvertToPromise(promises);

	        if (!isObject(castValue)) {
	            return apiRejection("cannot await properties of a non-object\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        } else if (castValue instanceof Promise) {
	            ret = castValue._then(Promise.props, undefined, undefined, undefined, undefined);
	        } else {
	            ret = new PropertiesPromiseArray(castValue).promise();
	        }

	        if (castValue instanceof Promise) {
	            ret._propagateFrom(castValue, 2);
	        }
	        return ret;
	    }

	    Promise.prototype.props = function () {
	        return props(this);
	    };

	    Promise.props = function (promises) {
	        return props(promises);
	    };
	};

/***/ },
/* 39 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, INTERNAL, tryConvertToPromise, apiRejection) {
	    var util = __webpack_require__(12);

	    var raceLater = function (promise) {
	        return promise.then(function (array) {
	            return race(array, promise);
	        });
	    };

	    function race(promises, parent) {
	        var maybePromise = tryConvertToPromise(promises);

	        if (maybePromise instanceof Promise) {
	            return raceLater(maybePromise);
	        } else {
	            promises = util.asArray(promises);
	            if (promises === null) return apiRejection("expecting an array or an iterable object but got " + util.classString(promises));
	        }

	        var ret = new Promise(INTERNAL);
	        if (parent !== undefined) {
	            ret._propagateFrom(parent, 3);
	        }
	        var fulfill = ret._fulfill;
	        var reject = ret._reject;
	        for (var i = 0, len = promises.length; i < len; ++i) {
	            var val = promises[i];

	            if (val === undefined && !(i in promises)) {
	                continue;
	            }

	            Promise.cast(val)._then(fulfill, reject, undefined, ret, null);
	        }
	        return ret;
	    }

	    Promise.race = function (promises) {
	        return race(promises, undefined);
	    };

	    Promise.prototype.race = function () {
	        return race(this, undefined);
	    };
	};

/***/ },
/* 40 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug) {
	    var getDomain = Promise._getDomain;
	    var util = __webpack_require__(12);
	    var tryCatch = util.tryCatch;

	    function ReductionPromiseArray(promises, fn, initialValue, _each) {
	        this.constructor$(promises);
	        var domain = getDomain();
	        this._fn = domain === null ? fn : util.domainBind(domain, fn);
	        if (initialValue !== undefined) {
	            initialValue = Promise.resolve(initialValue);
	            initialValue._attachCancellationCallback(this);
	        }
	        this._initialValue = initialValue;
	        this._currentCancellable = null;
	        if (_each === INTERNAL) {
	            this._eachValues = Array(this._length);
	        } else if (_each === 0) {
	            this._eachValues = null;
	        } else {
	            this._eachValues = undefined;
	        }
	        this._promise._captureStackTrace();
	        this._init$(undefined, -5);
	    }
	    util.inherits(ReductionPromiseArray, PromiseArray);

	    ReductionPromiseArray.prototype._gotAccum = function (accum) {
	        if (this._eachValues !== undefined && this._eachValues !== null && accum !== INTERNAL) {
	            this._eachValues.push(accum);
	        }
	    };

	    ReductionPromiseArray.prototype._eachComplete = function (value) {
	        if (this._eachValues !== null) {
	            this._eachValues.push(value);
	        }
	        return this._eachValues;
	    };

	    ReductionPromiseArray.prototype._init = function () {};

	    ReductionPromiseArray.prototype._resolveEmptyArray = function () {
	        this._resolve(this._eachValues !== undefined ? this._eachValues : this._initialValue);
	    };

	    ReductionPromiseArray.prototype.shouldCopyValues = function () {
	        return false;
	    };

	    ReductionPromiseArray.prototype._resolve = function (value) {
	        this._promise._resolveCallback(value);
	        this._values = null;
	    };

	    ReductionPromiseArray.prototype._resultCancelled = function (sender) {
	        if (sender === this._initialValue) return this._cancel();
	        if (this._isResolved()) return;
	        this._resultCancelled$();
	        if (this._currentCancellable instanceof Promise) {
	            this._currentCancellable.cancel();
	        }
	        if (this._initialValue instanceof Promise) {
	            this._initialValue.cancel();
	        }
	    };

	    ReductionPromiseArray.prototype._iterate = function (values) {
	        this._values = values;
	        var value;
	        var i;
	        var length = values.length;
	        if (this._initialValue !== undefined) {
	            value = this._initialValue;
	            i = 0;
	        } else {
	            value = Promise.resolve(values[0]);
	            i = 1;
	        }

	        this._currentCancellable = value;

	        if (!value.isRejected()) {
	            for (; i < length; ++i) {
	                var ctx = {
	                    accum: null,
	                    value: values[i],
	                    index: i,
	                    length: length,
	                    array: this
	                };
	                value = value._then(gotAccum, undefined, undefined, ctx, undefined);
	            }
	        }

	        if (this._eachValues !== undefined) {
	            value = value._then(this._eachComplete, undefined, undefined, this, undefined);
	        }
	        value._then(completed, completed, undefined, value, this);
	    };

	    Promise.prototype.reduce = function (fn, initialValue) {
	        return reduce(this, fn, initialValue, null);
	    };

	    Promise.reduce = function (promises, fn, initialValue, _each) {
	        return reduce(promises, fn, initialValue, _each);
	    };

	    function completed(valueOrReason, array) {
	        if (this.isFulfilled()) {
	            array._resolve(valueOrReason);
	        } else {
	            array._reject(valueOrReason);
	        }
	    }

	    function reduce(promises, fn, initialValue, _each) {
	        if (typeof fn !== "function") {
	            return apiRejection("expecting a function but got " + util.classString(fn));
	        }
	        var array = new ReductionPromiseArray(promises, fn, initialValue, _each);
	        return array.promise();
	    }

	    function gotAccum(accum) {
	        this.accum = accum;
	        this.array._gotAccum(accum);
	        var value = tryConvertToPromise(this.value, this.array._promise);
	        if (value instanceof Promise) {
	            this.array._currentCancellable = value;
	            return value._then(gotValue, undefined, undefined, this, undefined);
	        } else {
	            return gotValue.call(this, value);
	        }
	    }

	    function gotValue(value) {
	        var array = this.array;
	        var promise = array._promise;
	        var fn = tryCatch(array._fn);
	        promise._pushContext();
	        var ret;
	        if (array._eachValues !== undefined) {
	            ret = fn.call(promise._boundValue(), value, this.index, this.length);
	        } else {
	            ret = fn.call(promise._boundValue(), this.accum, value, this.index, this.length);
	        }
	        if (ret instanceof Promise) {
	            array._currentCancellable = ret;
	        }
	        var promiseCreated = promise._popContext();
	        debug.checkForgottenReturns(ret, promiseCreated, array._eachValues !== undefined ? "Promise.each" : "Promise.reduce", promise);
	        return ret;
	    }
	};

/***/ },
/* 41 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, debug) {
	    var PromiseInspection = Promise.PromiseInspection;
	    var util = __webpack_require__(12);

	    function SettledPromiseArray(values) {
	        this.constructor$(values);
	    }
	    util.inherits(SettledPromiseArray, PromiseArray);

	    SettledPromiseArray.prototype._promiseResolved = function (index, inspection) {
	        this._values[index] = inspection;
	        var totalResolved = ++this._totalResolved;
	        if (totalResolved >= this._length) {
	            this._resolve(this._values);
	            return true;
	        }
	        return false;
	    };

	    SettledPromiseArray.prototype._promiseFulfilled = function (value, index) {
	        var ret = new PromiseInspection();
	        ret._bitField = 33554432;
	        ret._settledValueField = value;
	        return this._promiseResolved(index, ret);
	    };
	    SettledPromiseArray.prototype._promiseRejected = function (reason, index) {
	        var ret = new PromiseInspection();
	        ret._bitField = 16777216;
	        ret._settledValueField = reason;
	        return this._promiseResolved(index, ret);
	    };

	    Promise.settle = function (promises) {
	        debug.deprecated(".settle()", ".reflect()");
	        return new SettledPromiseArray(promises).promise();
	    };

	    Promise.prototype.settle = function () {
	        return Promise.settle(this);
	    };
	};

/***/ },
/* 42 */
/***/ function(module, exports, __webpack_require__) {

	"use strict";

	module.exports = function (Promise, PromiseArray, apiRejection) {
	    var util = __webpack_require__(12);
	    var RangeError = __webpack_require__(17).RangeError;
	    var AggregateError = __webpack_require__(17).AggregateError;
	    var isArray = util.isArray;
	    var CANCELLATION = {};

	    function SomePromiseArray(values) {
	        this.constructor$(values);
	        this._howMany = 0;
	        this._unwrap = false;
	        this._initialized = false;
	    }
	    util.inherits(SomePromiseArray, PromiseArray);

	    SomePromiseArray.prototype._init = function () {
	        if (!this._initialized) {
	            return;
	        }
	        if (this._howMany === 0) {
	            this._resolve([]);
	            return;
	        }
	        this._init$(undefined, -5);
	        var isArrayResolved = isArray(this._values);
	        if (!this._isResolved() && isArrayResolved && this._howMany > this._canPossiblyFulfill()) {
	            this._reject(this._getRangeError(this.length()));
	        }
	    };

	    SomePromiseArray.prototype.init = function () {
	        this._initialized = true;
	        this._init();
	    };

	    SomePromiseArray.prototype.setUnwrap = function () {
	        this._unwrap = true;
	    };

	    SomePromiseArray.prototype.howMany = function () {
	        return this._howMany;
	    };

	    SomePromiseArray.prototype.setHowMany = function (count) {
	        this._howMany = count;
	    };

	    SomePromiseArray.prototype._promiseFulfilled = function (value) {
	        this._addFulfilled(value);
	        if (this._fulfilled() === this.howMany()) {
	            this._values.length = this.howMany();
	            if (this.howMany() === 1 && this._unwrap) {
	                this._resolve(this._values[0]);
	            } else {
	                this._resolve(this._values);
	            }
	            return true;
	        }
	        return false;
	    };
	    SomePromiseArray.prototype._promiseRejected = function (reason) {
	        this._addRejected(reason);
	        return this._checkOutcome();
	    };

	    SomePromiseArray.prototype._promiseCancelled = function () {
	        if (this._values instanceof Promise || this._values == null) {
	            return this._cancel();
	        }
	        this._addRejected(CANCELLATION);
	        return this._checkOutcome();
	    };

	    SomePromiseArray.prototype._checkOutcome = function () {
	        if (this.howMany() > this._canPossiblyFulfill()) {
	            var e = new AggregateError();
	            for (var i = this.length(); i < this._values.length; ++i) {
	                if (this._values[i] !== CANCELLATION) {
	                    e.push(this._values[i]);
	                }
	            }
	            if (e.length > 0) {
	                this._reject(e);
	            } else {
	                this._cancel();
	            }
	            return true;
	        }
	        return false;
	    };

	    SomePromiseArray.prototype._fulfilled = function () {
	        return this._totalResolved;
	    };

	    SomePromiseArray.prototype._rejected = function () {
	        return this._values.length - this.length();
	    };

	    SomePromiseArray.prototype._addRejected = function (reason) {
	        this._values.push(reason);
	    };

	    SomePromiseArray.prototype._addFulfilled = function (value) {
	        this._values[this._totalResolved++] = value;
	    };

	    SomePromiseArray.prototype._canPossiblyFulfill = function () {
	        return this.length() - this._rejected();
	    };

	    SomePromiseArray.prototype._getRangeError = function (count) {
	        var message = "Input array must contain at least " + this._howMany + " items but contains only " + count + " items";
	        return new RangeError(message);
	    };

	    SomePromiseArray.prototype._resolveEmptyArray = function () {
	        this._reject(this._getRangeError(0));
	    };

	    function some(promises, howMany) {
	        if ((howMany | 0) !== howMany || howMany < 0) {
	            return apiRejection("expecting a positive integer\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
	        }
	        var ret = new SomePromiseArray(promises);
	        var promise = ret.promise();
	        ret.setHowMany(howMany);
	        ret.init();
	        return promise;
	    }

	    Promise.some = function (promises, howMany) {
	        return some(promises, howMany);
	    };

	    Promise.prototype.some = function (howMany) {
	        return some(this, howMany);
	    };

	    Promise._SomePromiseArray = SomePromiseArray;
	};

/***/ },
/* 43 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise, INTERNAL) {
	    var PromiseMap = Promise.map;

	    Promise.prototype.filter = function (fn, options) {
	        return PromiseMap(this, fn, options, INTERNAL);
	    };

	    Promise.filter = function (promises, fn, options) {
	        return PromiseMap(promises, fn, options, INTERNAL);
	    };
	};

/***/ },
/* 44 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise, INTERNAL) {
	    var PromiseReduce = Promise.reduce;
	    var PromiseAll = Promise.all;

	    function promiseAllThis() {
	        return PromiseAll(this);
	    }

	    function PromiseMapSeries(promises, fn) {
	        return PromiseReduce(promises, fn, INTERNAL, INTERNAL);
	    }

	    Promise.prototype.each = function (fn) {
	        return PromiseReduce(this, fn, INTERNAL, 0)._then(promiseAllThis, undefined, undefined, this, undefined);
	    };

	    Promise.prototype.mapSeries = function (fn) {
	        return PromiseReduce(this, fn, INTERNAL, INTERNAL);
	    };

	    Promise.each = function (promises, fn) {
	        return PromiseReduce(promises, fn, INTERNAL, 0)._then(promiseAllThis, undefined, undefined, promises, undefined);
	    };

	    Promise.mapSeries = PromiseMapSeries;
	};

/***/ },
/* 45 */
/***/ function(module, exports) {

	"use strict";

	module.exports = function (Promise) {
	    var SomePromiseArray = Promise._SomePromiseArray;
	    function any(promises) {
	        var ret = new SomePromiseArray(promises);
	        var promise = ret.promise();
	        ret.setHowMany(1);
	        ret.setUnwrap();
	        ret.init();
	        return promise;
	    }

	    Promise.any = function (promises) {
	        return any(promises);
	    };

	    Promise.prototype.any = function () {
	        return any(this);
	    };
	};

/***/ },
/* 46 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var _ = __webpack_require__(7),
	    path = __webpack_require__(9),
	    constants = __webpack_require__(8);

	var options = {}; // Initialize the options - this will be populated when the csv2json function is called.

	/**
	 * Generate the JSON heading from the CSV
	 * @param lines
	 * @param callback
	 * @returns {*}
	 */
	var retrieveHeading = function (lines, callback) {
	    // If there are no lines passed in, return an error
	    if (!lines.length) {
	        return callback(new Error(constants.Errors.csv2json.noDataRetrieveHeading)); // Pass an error back to the user
	    }

	    // Generate and return the heading keys
	    return _.map(splitLine(lines[0]), function (headerKey, index) {
	        return {
	            value: options.TRIM_HEADER_FIELDS ? headerKey.trim() : headerKey,
	            index: index
	        };
	    });
	};

	/**
	 * Does the given value represent an array?
	 * @param value
	 * @returns {boolean}
	 */
	var isArrayRepresentation = function (value) {
	    // Verify that there is a value and it starts with '[' and ends with ']'
	    return value && /^\[.*\]$/.test(value);
	};

	/**
	 * Converts the value from a CSV 'array'
	 * @param val
	 * @returns {Array}
	 */
	var convertArrayRepresentation = function (arrayRepresentation) {
	    // Remove the '[' and ']' characters
	    arrayRepresentation = arrayRepresentation.replace(/(\[|\])/g, '');

	    // Split the arrayRepresentation into an array by the array delimiter
	    arrayRepresentation = arrayRepresentation.split(options.DELIMITER.ARRAY);

	    // Filter out non-empty strings
	    return _.filter(arrayRepresentation, function (value) {
	        return value;
	    });
	};

	/**
	 * Create a JSON document with the given keys (designated by the CSV header)
	 *   and the values (from the given line)
	 * @param keys String[]
	 * @param line String
	 * @returns {Object} created json document
	 */
	var createDocument = function (keys, line) {
	    line = splitLine(line); // Split the line using the given field delimiter after trimming whitespace
	    var val; // Temporary variable to set the current key's value to

	    // Reduce the keys into a JSON document representing the given line
	    return _.reduce(keys, function (document, key) {
	        // If there is a value at the key's index in the line, set the value; otherwise null
	        val = line[key.index] ? line[key.index] : null;

	        // If the user wants to trim field values, trim the value
	        val = options.TRIM_FIELD_VALUES && !_.isNull(val) ? val.trim() : val;

	        // If the value is an array representation, convert it
	        if (isArrayRepresentation(val)) {
	            val = convertArrayRepresentation(val);
	        }
	        // Otherwise add the key and value to the document
	        return path.setPath(document, key.value, val);
	    }, {});
	};

	/**
	 * Main helper function to convert the CSV to the JSON document array
	 * @param lines String[]
	 * @param callback Function callback function
	 * @returns {Array}
	 */
	var convertCSV = function (lines, callback) {
	    var generatedHeaders = retrieveHeading(lines, callback),
	        // Retrieve the headings from the CSV, unless the user specified the keys
	    nonHeaderLines = lines.splice(1),
	        // All lines except for the header line
	    // If the user provided keys, filter the generated keys to just the user provided keys so we also have the key index
	    headers = options.KEYS ? _.filter(generatedHeaders, function (headerKey) {
	        return _.contains(options.KEYS, headerKey.value);
	    }) : generatedHeaders;

	    return _.reduce(nonHeaderLines, function (documentArray, line) {
	        // For each line, create the document and add it to the array of documents
	        if (!line) {
	            return documentArray;
	        } // skip over empty lines
	        var generatedDocument = createDocument(headers, line.trim());
	        return documentArray.concat(generatedDocument);
	    }, []);
	};

	/**
	 * Helper function that splits a line so that we can handle wrapped fields
	 * @param line
	 */
	var splitLine = function (line) {
	    // If the fields are not wrapped, return the line split by the field delimiter
	    if (!options.DELIMITER.WRAP) {
	        return line.split(options.DELIMITER.FIELD);
	    }

	    // Parse out the line...
	    var splitLine = [],
	        character,
	        charBefore,
	        charAfter,
	        lastCharacterIndex = line.length - 1,
	        stateVariables = {
	        insideWrapDelimiter: false,
	        parsingValue: true,
	        startIndex: 0
	    },
	        index = 0;

	    // Loop through each character in the line to identify where to split the values
	    while (index < line.length) {
	        // Current character
	        character = line[index];
	        // Previous character
	        charBefore = index ? line[index - 1] : '';
	        // Next character
	        charAfter = index < lastCharacterIndex ? line[index + 1] : '';

	        // If we reached the end of the line, add the remaining value
	        if (index === lastCharacterIndex) {
	            splitLine.push(line.substring(stateVariables.startIndex, stateVariables.insideWrapDelimiter ? index : undefined));
	        }
	        // If the line starts with a wrap delimiter
	        else if (character === options.DELIMITER.WRAP && index === 0) {
	                stateVariables.insideWrapDelimiter = true;
	                stateVariables.parsingValue = true;
	                stateVariables.startIndex = index + 1;
	            }

	            // If we reached a wrap delimiter with a field delimiter after it (ie. *",)
	            else if (character === options.DELIMITER.WRAP && charAfter === options.DELIMITER.FIELD) {
	                    splitLine.push(line.substring(stateVariables.startIndex, index));
	                    stateVariables.startIndex = index + 2; // next value starts after the field delimiter
	                    stateVariables.insideWrapDelimiter = false;
	                    stateVariables.parsingValue = false;
	                }
	                // If we reached a wrap delimiter with a field delimiter after it (ie. ,"*)
	                else if (character === options.DELIMITER.WRAP && charBefore === options.DELIMITER.FIELD) {
	                        if (stateVariables.parsingValue) {
	                            splitLine.push(line.substring(stateVariables.startIndex, index - 1));
	                        }
	                        stateVariables.insideWrapDelimiter = true;
	                        stateVariables.parsingValue = true;
	                        stateVariables.startIndex = index + 1;
	                    }
	                    // If we reached a field delimiter and are not inside the wrap delimiters (ie. *,*)
	                    else if (character === options.DELIMITER.FIELD && charBefore !== options.DELIMITER.WRAP && charAfter !== options.DELIMITER.WRAP && !stateVariables.insideWrapDelimiter && stateVariables.parsingValue) {
	                            splitLine.push(line.substring(stateVariables.startIndex, index));
	                            stateVariables.startIndex = index + 1;
	                        } else if (character === options.DELIMITER.FIELD && charBefore === options.DELIMITER.WRAP && charAfter !== options.DELIMITER.WRAP) {
	                            stateVariables.insideWrapDelimiter = false;
	                            stateVariables.parsingValue = true;
	                            stateVariables.startIndex = index + 1;
	                        } else if (character === "\\" && charAfter === options.DELIMITER.WRAP && stateVariables.insideWrapDelimiter) {
	                            line = line.slice(0, index) + line.slice(index + 1); // Remove the current character from the line
	                            index--; // Move to position before to prevent moving ahead and skipping a character
	                            lastCharacterIndex--; // Update the value since we removed a character
	                        }
	        // Otherwise increment to the next character
	        index++;
	    }

	    return splitLine;
	};

	module.exports = {

	    /**
	     * Internally exported csv2json function
	     * Takes options as a document, data as a CSV string, and a callback that will be used to report the results
	     * @param opts Object options object
	     * @param data String csv string
	     * @param callback Function callback function
	     */
	    csv2json: function (opts, data, callback) {
	        // If a callback wasn't provided, throw an error
	        if (!callback) {
	            throw new Error(constants.Errors.callbackRequired);
	        }

	        // Shouldn't happen, but just in case
	        if (!opts) {
	            return callback(new Error(constants.Errors.optionsRequired));
	        }
	        options = opts; // Options were passed, set the global options value

	        // If we don't receive data, report an error
	        if (!data) {
	            return callback(new Error(constants.Errors.csv2json.cannotCallCsv2JsonOn + data + '.'));
	        }

	        // The data provided is not a string
	        if (!_.isString(data)) {
	            return callback(new Error(constants.Errors.csv2json.csvNotString)); // Report an error back to the caller
	        }

	        // Split the CSV into lines using the specified EOL option
	        var lines = data.split(options.DELIMITER.EOL),
	            json = convertCSV(lines, callback); // Retrieve the JSON document array
	        return callback(null, json); // Send the data back to the caller
	    }

	};

/***/ },
/* 47 */
/***/ function(module, exports, __webpack_require__) {

	module.exports = __webpack_require__(48);

/***/ },
/* 48 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);
	var bind = __webpack_require__(50);
	var Axios = __webpack_require__(51);

	/**
	 * Create an instance of Axios
	 *
	 * @param {Object} defaultConfig The default config for the instance
	 * @return {Axios} A new instance of Axios
	 */
	function createInstance(defaultConfig) {
	  var context = new Axios(defaultConfig);
	  var instance = bind(Axios.prototype.request, context);

	  // Copy axios.prototype to instance
	  utils.extend(instance, Axios.prototype, context);

	  // Copy context to instance
	  utils.extend(instance, context);

	  return instance;
	}

	// Create the default instance to be exported
	var axios = module.exports = createInstance();

	// Expose Axios class to allow class inheritance
	axios.Axios = Axios;

	// Factory for creating new instances
	axios.create = function create(defaultConfig) {
	  return createInstance(defaultConfig);
	};

	// Expose all/spread
	axios.all = function all(promises) {
	  return Promise.all(promises);
	};
	axios.spread = __webpack_require__(88);

/***/ },
/* 49 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var bind = __webpack_require__(50);

	/*global toString:true*/

	// utils is a library of generic helper functions non-specific to axios

	var toString = Object.prototype.toString;

	/**
	 * Determine if a value is an Array
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is an Array, otherwise false
	 */
	function isArray(val) {
	  return toString.call(val) === '[object Array]';
	}

	/**
	 * Determine if a value is an ArrayBuffer
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is an ArrayBuffer, otherwise false
	 */
	function isArrayBuffer(val) {
	  return toString.call(val) === '[object ArrayBuffer]';
	}

	/**
	 * Determine if a value is a FormData
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is an FormData, otherwise false
	 */
	function isFormData(val) {
	  return typeof FormData !== 'undefined' && val instanceof FormData;
	}

	/**
	 * Determine if a value is a view on an ArrayBuffer
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a view on an ArrayBuffer, otherwise false
	 */
	function isArrayBufferView(val) {
	  var result;
	  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView) {
	    result = ArrayBuffer.isView(val);
	  } else {
	    result = val && val.buffer && val.buffer instanceof ArrayBuffer;
	  }
	  return result;
	}

	/**
	 * Determine if a value is a String
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a String, otherwise false
	 */
	function isString(val) {
	  return typeof val === 'string';
	}

	/**
	 * Determine if a value is a Number
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a Number, otherwise false
	 */
	function isNumber(val) {
	  return typeof val === 'number';
	}

	/**
	 * Determine if a value is undefined
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if the value is undefined, otherwise false
	 */
	function isUndefined(val) {
	  return typeof val === 'undefined';
	}

	/**
	 * Determine if a value is an Object
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is an Object, otherwise false
	 */
	function isObject(val) {
	  return val !== null && typeof val === 'object';
	}

	/**
	 * Determine if a value is a Date
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a Date, otherwise false
	 */
	function isDate(val) {
	  return toString.call(val) === '[object Date]';
	}

	/**
	 * Determine if a value is a File
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a File, otherwise false
	 */
	function isFile(val) {
	  return toString.call(val) === '[object File]';
	}

	/**
	 * Determine if a value is a Blob
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a Blob, otherwise false
	 */
	function isBlob(val) {
	  return toString.call(val) === '[object Blob]';
	}

	/**
	 * Determine if a value is a Function
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a Function, otherwise false
	 */
	function isFunction(val) {
	  return toString.call(val) === '[object Function]';
	}

	/**
	 * Determine if a value is a Stream
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a Stream, otherwise false
	 */
	function isStream(val) {
	  return isObject(val) && isFunction(val.pipe);
	}

	/**
	 * Determine if a value is a URLSearchParams object
	 *
	 * @param {Object} val The value to test
	 * @returns {boolean} True if value is a URLSearchParams object, otherwise false
	 */
	function isURLSearchParams(val) {
	  return typeof URLSearchParams !== 'undefined' && val instanceof URLSearchParams;
	}

	/**
	 * Trim excess whitespace off the beginning and end of a string
	 *
	 * @param {String} str The String to trim
	 * @returns {String} The String freed of excess whitespace
	 */
	function trim(str) {
	  return str.replace(/^\s*/, '').replace(/\s*$/, '');
	}

	/**
	 * Determine if we're running in a standard browser environment
	 *
	 * This allows axios to run in a web worker, and react-native.
	 * Both environments support XMLHttpRequest, but not fully standard globals.
	 *
	 * web workers:
	 *  typeof window -> undefined
	 *  typeof document -> undefined
	 *
	 * react-native:
	 *  typeof document.createElement -> undefined
	 */
	function isStandardBrowserEnv() {
	  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.createElement === 'function';
	}

	/**
	 * Iterate over an Array or an Object invoking a function for each item.
	 *
	 * If `obj` is an Array callback will be called passing
	 * the value, index, and complete array for each item.
	 *
	 * If 'obj' is an Object callback will be called passing
	 * the value, key, and complete object for each property.
	 *
	 * @param {Object|Array} obj The object to iterate
	 * @param {Function} fn The callback to invoke for each item
	 */
	function forEach(obj, fn) {
	  // Don't bother if no value provided
	  if (obj === null || typeof obj === 'undefined') {
	    return;
	  }

	  // Force an array if not already something iterable
	  if (typeof obj !== 'object' && !isArray(obj)) {
	    /*eslint no-param-reassign:0*/
	    obj = [obj];
	  }

	  if (isArray(obj)) {
	    // Iterate over array values
	    for (var i = 0, l = obj.length; i < l; i++) {
	      fn.call(null, obj[i], i, obj);
	    }
	  } else {
	    // Iterate over object keys
	    for (var key in obj) {
	      if (obj.hasOwnProperty(key)) {
	        fn.call(null, obj[key], key, obj);
	      }
	    }
	  }
	}

	/**
	 * Accepts varargs expecting each argument to be an object, then
	 * immutably merges the properties of each object and returns result.
	 *
	 * When multiple objects contain the same key the later object in
	 * the arguments list will take precedence.
	 *
	 * Example:
	 *
	 * ```js
	 * var result = merge({foo: 123}, {foo: 456});
	 * console.log(result.foo); // outputs 456
	 * ```
	 *
	 * @param {Object} obj1 Object to merge
	 * @returns {Object} Result of all merge properties
	 */
	function merge() /* obj1, obj2, obj3, ... */{
	  var result = {};
	  function assignValue(val, key) {
	    if (typeof result[key] === 'object' && typeof val === 'object') {
	      result[key] = merge(result[key], val);
	    } else {
	      result[key] = val;
	    }
	  }

	  for (var i = 0, l = arguments.length; i < l; i++) {
	    forEach(arguments[i], assignValue);
	  }
	  return result;
	}

	/**
	 * Extends object a by mutably adding to it the properties of object b.
	 *
	 * @param {Object} a The object to be extended
	 * @param {Object} b The object to copy properties from
	 * @param {Object} thisArg The object to bind function to
	 * @return {Object} The resulting value of object a
	 */
	function extend(a, b, thisArg) {
	  forEach(b, function assignValue(val, key) {
	    if (thisArg && typeof val === 'function') {
	      a[key] = bind(val, thisArg);
	    } else {
	      a[key] = val;
	    }
	  });
	  return a;
	}

	module.exports = {
	  isArray: isArray,
	  isArrayBuffer: isArrayBuffer,
	  isFormData: isFormData,
	  isArrayBufferView: isArrayBufferView,
	  isString: isString,
	  isNumber: isNumber,
	  isObject: isObject,
	  isUndefined: isUndefined,
	  isDate: isDate,
	  isFile: isFile,
	  isBlob: isBlob,
	  isFunction: isFunction,
	  isStream: isStream,
	  isURLSearchParams: isURLSearchParams,
	  isStandardBrowserEnv: isStandardBrowserEnv,
	  forEach: forEach,
	  merge: merge,
	  extend: extend,
	  trim: trim
	};

/***/ },
/* 50 */
/***/ function(module, exports) {

	'use strict';

	module.exports = function bind(fn, thisArg) {
	  return function wrap() {
	    var args = new Array(arguments.length);
	    for (var i = 0; i < args.length; i++) {
	      args[i] = arguments[i];
	    }
	    return fn.apply(thisArg, args);
	  };
	};

/***/ },
/* 51 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var defaults = __webpack_require__(52);
	var utils = __webpack_require__(49);
	var InterceptorManager = __webpack_require__(54);
	var dispatchRequest = __webpack_require__(55);
	var isAbsoluteURL = __webpack_require__(86);
	var combineURLs = __webpack_require__(87);

	/**
	 * Create a new instance of Axios
	 *
	 * @param {Object} defaultConfig The default config for the instance
	 */
	function Axios(defaultConfig) {
	  this.defaults = utils.merge(defaults, defaultConfig);
	  this.interceptors = {
	    request: new InterceptorManager(),
	    response: new InterceptorManager()
	  };
	}

	/**
	 * Dispatch a request
	 *
	 * @param {Object} config The config specific for this request (merged with this.defaults)
	 */
	Axios.prototype.request = function request(config) {
	  /*eslint no-param-reassign:0*/
	  // Allow for axios('example/url'[, config]) a la fetch API
	  if (typeof config === 'string') {
	    config = utils.merge({
	      url: arguments[0]
	    }, arguments[1]);
	  }

	  config = utils.merge(defaults, this.defaults, { method: 'get' }, config);

	  // Support baseURL config
	  if (config.baseURL && !isAbsoluteURL(config.url)) {
	    config.url = combineURLs(config.baseURL, config.url);
	  }

	  // Hook up interceptors middleware
	  var chain = [dispatchRequest, undefined];
	  var promise = Promise.resolve(config);

	  this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
	    chain.unshift(interceptor.fulfilled, interceptor.rejected);
	  });

	  this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
	    chain.push(interceptor.fulfilled, interceptor.rejected);
	  });

	  while (chain.length) {
	    promise = promise.then(chain.shift(), chain.shift());
	  }

	  return promise;
	};

	// Provide aliases for supported request methods
	utils.forEach(['delete', 'get', 'head'], function forEachMethodNoData(method) {
	  /*eslint func-names:0*/
	  Axios.prototype[method] = function (url, config) {
	    return this.request(utils.merge(config || {}, {
	      method: method,
	      url: url
	    }));
	  };
	});

	utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
	  /*eslint func-names:0*/
	  Axios.prototype[method] = function (url, data, config) {
	    return this.request(utils.merge(config || {}, {
	      method: method,
	      url: url,
	      data: data
	    }));
	  };
	});

	module.exports = Axios;

/***/ },
/* 52 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);
	var normalizeHeaderName = __webpack_require__(53);

	var PROTECTION_PREFIX = /^\)\]\}',?\n/;
	var DEFAULT_CONTENT_TYPE = {
	  'Content-Type': 'application/x-www-form-urlencoded'
	};

	function setContentTypeIfUnset(headers, value) {
	  if (!utils.isUndefined(headers) && utils.isUndefined(headers['Content-Type'])) {
	    headers['Content-Type'] = value;
	  }
	}

	module.exports = {
	  transformRequest: [function transformRequest(data, headers) {
	    normalizeHeaderName(headers, 'Content-Type');
	    if (utils.isFormData(data) || utils.isArrayBuffer(data) || utils.isStream(data) || utils.isFile(data) || utils.isBlob(data)) {
	      return data;
	    }
	    if (utils.isArrayBufferView(data)) {
	      return data.buffer;
	    }
	    if (utils.isURLSearchParams(data)) {
	      setContentTypeIfUnset(headers, 'application/x-www-form-urlencoded;charset=utf-8');
	      return data.toString();
	    }
	    if (utils.isObject(data)) {
	      setContentTypeIfUnset(headers, 'application/json;charset=utf-8');
	      return JSON.stringify(data);
	    }
	    return data;
	  }],

	  transformResponse: [function transformResponse(data) {
	    /*eslint no-param-reassign:0*/
	    if (typeof data === 'string') {
	      data = data.replace(PROTECTION_PREFIX, '');
	      try {
	        data = JSON.parse(data);
	      } catch (e) {/* Ignore */}
	    }
	    return data;
	  }],

	  headers: {
	    common: {
	      'Accept': 'application/json, text/plain, */*'
	    },
	    patch: utils.merge(DEFAULT_CONTENT_TYPE),
	    post: utils.merge(DEFAULT_CONTENT_TYPE),
	    put: utils.merge(DEFAULT_CONTENT_TYPE)
	  },

	  timeout: 0,

	  xsrfCookieName: 'XSRF-TOKEN',
	  xsrfHeaderName: 'X-XSRF-TOKEN',

	  maxContentLength: -1,

	  validateStatus: function validateStatus(status) {
	    return status >= 200 && status < 300;
	  }
	};

/***/ },
/* 53 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	module.exports = function normalizeHeaderName(headers, normalizedName) {
	  utils.forEach(headers, function processHeader(value, name) {
	    if (name !== normalizedName && name.toUpperCase() === normalizedName.toUpperCase()) {
	      headers[normalizedName] = value;
	      delete headers[name];
	    }
	  });
	};

/***/ },
/* 54 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	function InterceptorManager() {
	  this.handlers = [];
	}

	/**
	 * Add a new interceptor to the stack
	 *
	 * @param {Function} fulfilled The function to handle `then` for a `Promise`
	 * @param {Function} rejected The function to handle `reject` for a `Promise`
	 *
	 * @return {Number} An ID used to remove interceptor later
	 */
	InterceptorManager.prototype.use = function use(fulfilled, rejected) {
	  this.handlers.push({
	    fulfilled: fulfilled,
	    rejected: rejected
	  });
	  return this.handlers.length - 1;
	};

	/**
	 * Remove an interceptor from the stack
	 *
	 * @param {Number} id The ID that was returned by `use`
	 */
	InterceptorManager.prototype.eject = function eject(id) {
	  if (this.handlers[id]) {
	    this.handlers[id] = null;
	  }
	};

	/**
	 * Iterate over all the registered interceptors
	 *
	 * This method is particularly useful for skipping over any
	 * interceptors that may have become `null` calling `eject`.
	 *
	 * @param {Function} fn The function to call for each interceptor
	 */
	InterceptorManager.prototype.forEach = function forEach(fn) {
	  utils.forEach(this.handlers, function forEachHandler(h) {
	    if (h !== null) {
	      fn(h);
	    }
	  });
	};

	module.exports = InterceptorManager;

/***/ },
/* 55 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);
	var transformData = __webpack_require__(56);

	/**
	 * Dispatch a request to the server using whichever adapter
	 * is supported by the current environment.
	 *
	 * @param {object} config The config that is to be used for the request
	 * @returns {Promise} The Promise to be fulfilled
	 */
	module.exports = function dispatchRequest(config) {
	  // Ensure headers exist
	  config.headers = config.headers || {};

	  // Transform request data
	  config.data = transformData(config.data, config.headers, config.transformRequest);

	  // Flatten headers
	  config.headers = utils.merge(config.headers.common || {}, config.headers[config.method] || {}, config.headers || {});

	  utils.forEach(['delete', 'get', 'head', 'post', 'put', 'patch', 'common'], function cleanHeaderConfig(method) {
	    delete config.headers[method];
	  });

	  var adapter;

	  if (typeof config.adapter === 'function') {
	    // For custom adapter support
	    adapter = config.adapter;
	  } else if (typeof XMLHttpRequest !== 'undefined') {
	    // For browsers use XHR adapter
	    adapter = __webpack_require__(57);
	  } else if (typeof process !== 'undefined') {
	    // For node use HTTP adapter
	    adapter = __webpack_require__(66);
	  }

	  return Promise.resolve(config)
	  // Wrap synchronous adapter errors and pass configuration
	  .then(adapter).then(function onFulfilled(response) {
	    // Transform response data
	    response.data = transformData(response.data, response.headers, config.transformResponse);

	    return response;
	  }, function onRejected(error) {
	    // Transform response data
	    if (error && error.response) {
	      error.response.data = transformData(error.response.data, error.response.headers, config.transformResponse);
	    }

	    return Promise.reject(error);
	  });
	};

/***/ },
/* 56 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	/**
	 * Transform the data for a request or a response
	 *
	 * @param {Object|String} data The data to be transformed
	 * @param {Array} headers The headers for the request or response
	 * @param {Array|Function} fns A single function or Array of functions
	 * @returns {*} The resulting transformed data
	 */
	module.exports = function transformData(data, headers, fns) {
	  /*eslint no-param-reassign:0*/
	  utils.forEach(fns, function transform(fn) {
	    data = fn(data, headers);
	  });

	  return data;
	};

/***/ },
/* 57 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);
	var settle = __webpack_require__(58);
	var buildURL = __webpack_require__(61);
	var parseHeaders = __webpack_require__(62);
	var isURLSameOrigin = __webpack_require__(63);
	var createError = __webpack_require__(59);
	var btoa = typeof window !== 'undefined' && window.btoa || __webpack_require__(64);

	module.exports = function xhrAdapter(config) {
	  return new Promise(function dispatchXhrRequest(resolve, reject) {
	    var requestData = config.data;
	    var requestHeaders = config.headers;

	    if (utils.isFormData(requestData)) {
	      delete requestHeaders['Content-Type']; // Let the browser set it
	    }

	    var request = new XMLHttpRequest();
	    var loadEvent = 'onreadystatechange';
	    var xDomain = false;

	    // For IE 8/9 CORS support
	    // Only supports POST and GET calls and doesn't returns the response headers.
	    // DON'T do this for testing b/c XMLHttpRequest is mocked, not XDomainRequest.
	    if (process.env.NODE_ENV !== 'test' && typeof window !== 'undefined' && window.XDomainRequest && !('withCredentials' in request) && !isURLSameOrigin(config.url)) {
	      request = new window.XDomainRequest();
	      loadEvent = 'onload';
	      xDomain = true;
	      request.onprogress = function handleProgress() {};
	      request.ontimeout = function handleTimeout() {};
	    }

	    // HTTP basic authentication
	    if (config.auth) {
	      var username = config.auth.username || '';
	      var password = config.auth.password || '';
	      requestHeaders.Authorization = 'Basic ' + btoa(username + ':' + password);
	    }

	    request.open(config.method.toUpperCase(), buildURL(config.url, config.params, config.paramsSerializer), true);

	    // Set the request timeout in MS
	    request.timeout = config.timeout;

	    // Listen for ready state
	    request[loadEvent] = function handleLoad() {
	      if (!request || request.readyState !== 4 && !xDomain) {
	        return;
	      }

	      // The request errored out and we didn't get a response, this will be
	      // handled by onerror instead
	      if (request.status === 0) {
	        return;
	      }

	      // Prepare the response
	      var responseHeaders = 'getAllResponseHeaders' in request ? parseHeaders(request.getAllResponseHeaders()) : null;
	      var responseData = !config.responseType || config.responseType === 'text' ? request.responseText : request.response;
	      var response = {
	        data: responseData,
	        // IE sends 1223 instead of 204 (https://github.com/mzabriskie/axios/issues/201)
	        status: request.status === 1223 ? 204 : request.status,
	        statusText: request.status === 1223 ? 'No Content' : request.statusText,
	        headers: responseHeaders,
	        config: config,
	        request: request
	      };

	      settle(resolve, reject, response);

	      // Clean up request
	      request = null;
	    };

	    // Handle low level network errors
	    request.onerror = function handleError() {
	      // Real errors are hidden from us by the browser
	      // onerror should only fire if it's a network error
	      reject(createError('Network Error', config));

	      // Clean up request
	      request = null;
	    };

	    // Handle timeout
	    request.ontimeout = function handleTimeout() {
	      reject(createError('timeout of ' + config.timeout + 'ms exceeded', config, 'ECONNABORTED'));

	      // Clean up request
	      request = null;
	    };

	    // Add xsrf header
	    // This is only done if running in a standard browser environment.
	    // Specifically not if we're in a web worker, or react-native.
	    if (utils.isStandardBrowserEnv()) {
	      var cookies = __webpack_require__(65);

	      // Add xsrf header
	      var xsrfValue = config.withCredentials || isURLSameOrigin(config.url) ? cookies.read(config.xsrfCookieName) : undefined;

	      if (xsrfValue) {
	        requestHeaders[config.xsrfHeaderName] = xsrfValue;
	      }
	    }

	    // Add headers to the request
	    if ('setRequestHeader' in request) {
	      utils.forEach(requestHeaders, function setRequestHeader(val, key) {
	        if (typeof requestData === 'undefined' && key.toLowerCase() === 'content-type') {
	          // Remove Content-Type if data is undefined
	          delete requestHeaders[key];
	        } else {
	          // Otherwise add header to the request
	          request.setRequestHeader(key, val);
	        }
	      });
	    }

	    // Add withCredentials to request if needed
	    if (config.withCredentials) {
	      request.withCredentials = true;
	    }

	    // Add responseType to request if needed
	    if (config.responseType) {
	      try {
	        request.responseType = config.responseType;
	      } catch (e) {
	        if (request.responseType !== 'json') {
	          throw e;
	        }
	      }
	    }

	    // Handle progress if needed
	    if (typeof config.progress === 'function') {
	      if (config.method === 'post' || config.method === 'put') {
	        request.upload.addEventListener('progress', config.progress);
	      } else if (config.method === 'get') {
	        request.addEventListener('progress', config.progress);
	      }
	    }

	    if (requestData === undefined) {
	      requestData = null;
	    }

	    // Send the request
	    request.send(requestData);
	  });
	};

/***/ },
/* 58 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var createError = __webpack_require__(59);

	/**
	 * Resolve or reject a Promise based on response status.
	 *
	 * @param {Function} resolve A function that resolves the promise.
	 * @param {Function} reject A function that rejects the promise.
	 * @param {object} response The response.
	 */
	module.exports = function settle(resolve, reject, response) {
	  var validateStatus = response.config.validateStatus;
	  // Note: status is not exposed by XDomainRequest
	  if (!response.status || !validateStatus || validateStatus(response.status)) {
	    resolve(response);
	  } else {
	    reject(createError('Request failed with status code ' + response.status, response.config, null, response));
	  }
	};

/***/ },
/* 59 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var enhanceError = __webpack_require__(60);

	/**
	 * Create an Error with the specified message, config, error code, and response.
	 *
	 * @param {string} message The error message.
	 * @param {Object} config The config.
	 * @param {string} [code] The error code (for example, 'ECONNABORTED').
	 @ @param {Object} [response] The response.
	 * @returns {Error} The created error.
	 */
	module.exports = function createError(message, config, code, response) {
	  var error = new Error(message);
	  return enhanceError(error, config, code, response);
	};

/***/ },
/* 60 */
/***/ function(module, exports) {

	'use strict';

	/**
	 * Update an Error with the specified config, error code, and response.
	 *
	 * @param {Error} error The error to update.
	 * @param {Object} config The config.
	 * @param {string} [code] The error code (for example, 'ECONNABORTED').
	 @ @param {Object} [response] The response.
	 * @returns {Error} The error.
	 */

	module.exports = function enhanceError(error, config, code, response) {
	  error.config = config;
	  if (code) {
	    error.code = code;
	  }
	  error.response = response;
	  return error;
	};

/***/ },
/* 61 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	function encode(val) {
	  return encodeURIComponent(val).replace(/%40/gi, '@').replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%20/g, '+').replace(/%5B/gi, '[').replace(/%5D/gi, ']');
	}

	/**
	 * Build a URL by appending params to the end
	 *
	 * @param {string} url The base of the url (e.g., http://www.google.com)
	 * @param {object} [params] The params to be appended
	 * @returns {string} The formatted url
	 */
	module.exports = function buildURL(url, params, paramsSerializer) {
	  /*eslint no-param-reassign:0*/
	  if (!params) {
	    return url;
	  }

	  var serializedParams;
	  if (paramsSerializer) {
	    serializedParams = paramsSerializer(params);
	  } else if (utils.isURLSearchParams(params)) {
	    serializedParams = params.toString();
	  } else {
	    var parts = [];

	    utils.forEach(params, function serialize(val, key) {
	      if (val === null || typeof val === 'undefined') {
	        return;
	      }

	      if (utils.isArray(val)) {
	        key = key + '[]';
	      }

	      if (!utils.isArray(val)) {
	        val = [val];
	      }

	      utils.forEach(val, function parseValue(v) {
	        if (utils.isDate(v)) {
	          v = v.toISOString();
	        } else if (utils.isObject(v)) {
	          v = JSON.stringify(v);
	        }
	        parts.push(encode(key) + '=' + encode(v));
	      });
	    });

	    serializedParams = parts.join('&');
	  }

	  if (serializedParams) {
	    url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
	  }

	  return url;
	};

/***/ },
/* 62 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	/**
	 * Parse headers into an object
	 *
	 * ```
	 * Date: Wed, 27 Aug 2014 08:58:49 GMT
	 * Content-Type: application/json
	 * Connection: keep-alive
	 * Transfer-Encoding: chunked
	 * ```
	 *
	 * @param {String} headers Headers needing to be parsed
	 * @returns {Object} Headers parsed into an object
	 */
	module.exports = function parseHeaders(headers) {
	  var parsed = {};
	  var key;
	  var val;
	  var i;

	  if (!headers) {
	    return parsed;
	  }

	  utils.forEach(headers.split('\n'), function parser(line) {
	    i = line.indexOf(':');
	    key = utils.trim(line.substr(0, i)).toLowerCase();
	    val = utils.trim(line.substr(i + 1));

	    if (key) {
	      parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
	    }
	  });

	  return parsed;
	};

/***/ },
/* 63 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	module.exports = utils.isStandardBrowserEnv() ?

	// Standard browser envs have full support of the APIs needed to test
	// whether the request URL is of the same origin as current location.
	function standardBrowserEnv() {
	  var msie = /(msie|trident)/i.test(navigator.userAgent);
	  var urlParsingNode = document.createElement('a');
	  var originURL;

	  /**
	  * Parse a URL to discover it's components
	  *
	  * @param {String} url The URL to be parsed
	  * @returns {Object}
	  */
	  function resolveURL(url) {
	    var href = url;

	    if (msie) {
	      // IE needs attribute set twice to normalize properties
	      urlParsingNode.setAttribute('href', href);
	      href = urlParsingNode.href;
	    }

	    urlParsingNode.setAttribute('href', href);

	    // urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
	    return {
	      href: urlParsingNode.href,
	      protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
	      host: urlParsingNode.host,
	      search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
	      hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
	      hostname: urlParsingNode.hostname,
	      port: urlParsingNode.port,
	      pathname: urlParsingNode.pathname.charAt(0) === '/' ? urlParsingNode.pathname : '/' + urlParsingNode.pathname
	    };
	  }

	  originURL = resolveURL(window.location.href);

	  /**
	  * Determine if a URL shares the same origin as the current location
	  *
	  * @param {String} requestURL The URL to test
	  * @returns {boolean} True if URL shares the same origin, otherwise false
	  */
	  return function isURLSameOrigin(requestURL) {
	    var parsed = utils.isString(requestURL) ? resolveURL(requestURL) : requestURL;
	    return parsed.protocol === originURL.protocol && parsed.host === originURL.host;
	  };
	}() :

	// Non standard browser envs (web workers, react-native) lack needed support.
	function nonStandardBrowserEnv() {
	  return function isURLSameOrigin() {
	    return true;
	  };
	}();

/***/ },
/* 64 */
/***/ function(module, exports) {

	'use strict';

	// btoa polyfill for IE<10 courtesy https://github.com/davidchambers/Base64.js

	var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

	function E() {
	  this.message = 'String contains an invalid character';
	}
	E.prototype = new Error();
	E.prototype.code = 5;
	E.prototype.name = 'InvalidCharacterError';

	function btoa(input) {
	  var str = String(input);
	  var output = '';
	  for (
	  // initialize result and counter
	  var block, charCode, idx = 0, map = chars;
	  // if the next str index does not exist:
	  //   change the mapping table to "="
	  //   check if d has no fractional digits
	  str.charAt(idx | 0) || (map = '=', idx % 1);
	  // "8 - idx % 1 * 8" generates the sequence 2, 4, 6, 8
	  output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
	    charCode = str.charCodeAt(idx += 3 / 4);
	    if (charCode > 0xFF) {
	      throw new E();
	    }
	    block = block << 8 | charCode;
	  }
	  return output;
	}

	module.exports = btoa;

/***/ },
/* 65 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);

	module.exports = utils.isStandardBrowserEnv() ?

	// Standard browser envs support document.cookie
	function standardBrowserEnv() {
	  return {
	    write: function write(name, value, expires, path, domain, secure) {
	      var cookie = [];
	      cookie.push(name + '=' + encodeURIComponent(value));

	      if (utils.isNumber(expires)) {
	        cookie.push('expires=' + new Date(expires).toGMTString());
	      }

	      if (utils.isString(path)) {
	        cookie.push('path=' + path);
	      }

	      if (utils.isString(domain)) {
	        cookie.push('domain=' + domain);
	      }

	      if (secure === true) {
	        cookie.push('secure');
	      }

	      document.cookie = cookie.join('; ');
	    },

	    read: function read(name) {
	      var match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
	      return match ? decodeURIComponent(match[3]) : null;
	    },

	    remove: function remove(name) {
	      this.write(name, '', Date.now() - 86400000);
	    }
	  };
	}() :

	// Non standard browser env (web workers, react-native) lack needed support.
	function nonStandardBrowserEnv() {
	  return {
	    write: function write() {},
	    read: function read() {
	      return null;
	    },
	    remove: function remove() {}
	  };
	}();

/***/ },
/* 66 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils = __webpack_require__(49);
	var settle = __webpack_require__(58);
	var buildURL = __webpack_require__(61);
	var http = __webpack_require__(67);
	var https = __webpack_require__(68);
	var httpFollow = __webpack_require__(69).http;
	var httpsFollow = __webpack_require__(69).https;
	var url = __webpack_require__(71);
	var zlib = __webpack_require__(83);
	var pkg = __webpack_require__(84);
	var Buffer = __webpack_require__(85).Buffer;
	var createError = __webpack_require__(59);
	var enhanceError = __webpack_require__(60);

	/*eslint consistent-return:0*/
	module.exports = function httpAdapter(config) {
	  return new Promise(function dispatchHttpRequest(resolve, reject) {
	    var data = config.data;
	    var headers = config.headers;
	    var timer;
	    var aborted = false;

	    // Set User-Agent (required by some servers)
	    // Only set header if it hasn't been set in config
	    // See https://github.com/mzabriskie/axios/issues/69
	    if (!headers['User-Agent'] && !headers['user-agent']) {
	      headers['User-Agent'] = 'axios/' + pkg.version;
	    }

	    if (data && !utils.isStream(data)) {
	      if (utils.isArrayBuffer(data)) {
	        data = new Buffer(new Uint8Array(data));
	      } else if (utils.isString(data)) {
	        data = new Buffer(data, 'utf-8');
	      } else {
	        return reject(createError('Data after transformation must be a string, an ArrayBuffer, or a Stream', config));
	      }

	      // Add Content-Length header if data exists
	      headers['Content-Length'] = data.length;
	    }

	    // HTTP basic authentication
	    var auth = undefined;
	    if (config.auth) {
	      var username = config.auth.username || '';
	      var password = config.auth.password || '';
	      auth = username + ':' + password;
	    }

	    // Parse url
	    var parsed = url.parse(config.url);
	    if (!auth && parsed.auth) {
	      var urlAuth = parsed.auth.split(':');
	      var urlUsername = urlAuth[0] || '';
	      var urlPassword = urlAuth[1] || '';
	      auth = urlUsername + ':' + urlPassword;
	    }
	    var options = {
	      hostname: parsed.hostname,
	      port: parsed.port,
	      path: buildURL(parsed.path, config.params, config.paramsSerializer).replace(/^\?/, ''),
	      method: config.method,
	      headers: headers,
	      agent: config.agent,
	      auth: auth
	    };

	    if (config.proxy) {
	      options.host = config.proxy.host;
	      options.port = config.proxy.port;
	      options.path = parsed.protocol + '//' + parsed.hostname + options.path;
	    }

	    var transport;
	    if (config.maxRedirects === 0) {
	      transport = parsed.protocol === 'https:' ? https : http;
	    } else {
	      if (config.maxRedirects) {
	        options.maxRedirects = config.maxRedirects;
	      }
	      transport = parsed.protocol === 'https:' ? httpsFollow : httpFollow;
	    }

	    // Create the request
	    var req = transport.request(options, function handleResponse(res) {
	      if (aborted) return;

	      // Response has been received so kill timer that handles request timeout
	      clearTimeout(timer);
	      timer = null;

	      // uncompress the response body transparently if required
	      var stream = res;
	      switch (res.headers['content-encoding']) {
	        /*eslint default-case:0*/
	        case 'gzip':
	        case 'compress':
	        case 'deflate':
	          // add the unzipper to the body stream processing pipeline
	          stream = stream.pipe(zlib.createUnzip());

	          // remove the content-encoding in order to not confuse downstream operations
	          delete res.headers['content-encoding'];
	          break;
	      }

	      var response = {
	        status: res.statusCode,
	        statusText: res.statusMessage,
	        headers: res.headers,
	        config: config,
	        request: req
	      };

	      if (config.responseType === 'stream') {
	        response.data = stream;
	        settle(resolve, reject, response);
	      } else {
	        var responseBuffer = [];
	        stream.on('data', function handleStreamData(chunk) {
	          responseBuffer.push(chunk);

	          // make sure the content length is not over the maxContentLength if specified
	          if (config.maxContentLength > -1 && Buffer.concat(responseBuffer).length > config.maxContentLength) {
	            reject(createError('maxContentLength size of ' + config.maxContentLength + ' exceeded', config));
	          }
	        });

	        stream.on('error', function handleStreamError(err) {
	          if (aborted) return;
	          reject(enhanceError(err, config));
	        });

	        stream.on('end', function handleStreamEnd() {
	          var responseData = Buffer.concat(responseBuffer);
	          if (config.responseType !== 'arraybuffer') {
	            responseData = responseData.toString('utf8');
	          }

	          response.data = responseData;
	          settle(resolve, reject, response);
	        });
	      }
	    });

	    // Handle errors
	    req.on('error', function handleRequestError(err) {
	      if (aborted) return;
	      reject(enhanceError(err, config));
	    });

	    // Handle request timeout
	    if (config.timeout && !timer) {
	      timer = setTimeout(function handleRequestTimeout() {
	        req.abort();
	        reject(createError('timeout of ' + config.timeout + 'ms exceeded', config, 'ECONNABORTED'));
	        aborted = true;
	      }, config.timeout);
	    }

	    // Send the request
	    if (utils.isStream(data)) {
	      data.pipe(req);
	    } else {
	      req.end(data);
	    }
	  });
	};

/***/ },
/* 67 */
/***/ function(module, exports) {

	module.exports = require("http");

/***/ },
/* 68 */
/***/ function(module, exports) {

	module.exports = require("https");

/***/ },
/* 69 */
/***/ function(module, exports, __webpack_require__) {

	module.exports = __webpack_require__(70)({
	  'http': __webpack_require__(67),
	  'https': __webpack_require__(68)
	});

/***/ },
/* 70 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var url = __webpack_require__(71);
	var debug = __webpack_require__(72)('follow-redirects');
	var assert = __webpack_require__(81);
	var consume = __webpack_require__(82);

	module.exports = function (_nativeProtocols) {
	  var nativeProtocols = {};

	  var publicApi = {
	    maxRedirects: 5
	  };

	  for (var p in _nativeProtocols) {
	    /* istanbul ignore else */
	    if (_nativeProtocols.hasOwnProperty(p)) {
	      // http://www.ietf.org/rfc/rfc2396.txt - Section 3.1
	      assert(/^[A-Z][A-Z\+\-\.]*$/i.test(p), JSON.stringify(p) + ' is not a valid scheme name');
	      generateWrapper(p, _nativeProtocols[p]);
	    }
	  }

	  return publicApi;

	  function execute(options) {
	    var clientRequest;
	    var fetchedUrls = [];

	    return clientRequest = cb();

	    function cb(res) {
	      // skip the redirection logic on the first call.
	      if (res) {
	        var fetchedUrl = url.format(options);
	        fetchedUrls.unshift(fetchedUrl);

	        if (!isRedirect(res)) {
	          res.fetchedUrls = fetchedUrls;
	          return options.userCallback(res);
	        }

	        // we are going to follow the redirect, but in node 0.10 we must first attach a data listener
	        // to consume the stream and send the 'end' event
	        consume(res);

	        // need to use url.resolve() in case location is a relative URL
	        var redirectUrl = url.resolve(fetchedUrl, res.headers.location);
	        debug('redirecting to', redirectUrl);

	        // clean all the properties related to the old url away, and copy from the redirect url
	        wipeUrlProps(options);
	        extend(options, url.parse(redirectUrl));
	      }

	      if (fetchedUrls.length > options.maxRedirects) {
	        var err = new Error('Max redirects exceeded.');
	        return forwardError(err);
	      }

	      options.nativeProtocol = nativeProtocols[options.protocol];
	      options.defaultRequest = defaultMakeRequest;

	      var req = (options.makeRequest || defaultMakeRequest)(options, cb, res);

	      if (res) {
	        req.on('error', forwardError);
	      }
	      return req;
	    }

	    function defaultMakeRequest(options, cb, res) {
	      if (res) {
	        // This is a redirect, so use only GET methods
	        options.method = 'GET';
	      }

	      var req = options.nativeProtocol.request(options, cb);

	      if (res) {
	        // We leave the user to call `end` on the first request
	        req.end();
	      }

	      return req;
	    }

	    // bubble errors that occur on the redirect back up to the initiating client request
	    // object, otherwise they wind up killing the process.
	    function forwardError(err) {
	      clientRequest.emit('error', err);
	    }
	  }

	  function generateWrapper(scheme, nativeProtocol) {
	    var wrappedProtocol = scheme + ':';
	    var H = function () {};
	    H.prototype = nativeProtocols[wrappedProtocol] = nativeProtocol;
	    H = new H();
	    publicApi[scheme] = H;

	    H.request = function (options, callback) {
	      return execute(parseOptions(options, callback, wrappedProtocol));
	    };

	    // see https://github.com/joyent/node/blob/master/lib/http.js#L1623
	    H.get = function (options, callback) {
	      options = parseOptions(options, callback, wrappedProtocol);
	      var req = execute(options);
	      req.end();
	      return req;
	    };
	  }

	  // returns a safe copy of options (or a parsed url object if options was a string).
	  // validates that the supplied callback is a function
	  function parseOptions(options, callback, wrappedProtocol) {
	    assert.equal(typeof callback, 'function', 'callback must be a function');
	    if ('string' === typeof options) {
	      options = url.parse(options);
	      options.maxRedirects = publicApi.maxRedirects;
	    } else {
	      options = extend({
	        maxRedirects: publicApi.maxRedirects,
	        protocol: wrappedProtocol
	      }, options);
	    }
	    assert.equal(options.protocol, wrappedProtocol, 'protocol mismatch');
	    options.protocol = wrappedProtocol;
	    options.userCallback = callback;

	    debug('options', options);
	    return options;
	  }
	};

	// copies source's own properties onto destination and returns destination
	function extend(destination, source) {
	  for (var i in source) {
	    if (source.hasOwnProperty(i)) {
	      destination[i] = source[i];
	    }
	  }
	  return destination;
	}

	// to redirect the result must have
	// a statusCode between 300-399
	// and a `Location` header
	function isRedirect(res) {
	  return res.statusCode >= 300 && res.statusCode <= 399 && 'location' in res.headers;
	}

	// nulls all url related properties on the object.
	// required on node <10
	function wipeUrlProps(options) {
	  for (var i = 0, l = urlProps.length; i < l; ++i) {
	    options[urlProps[i]] = null;
	  }
	}
	var urlProps = ['protocol', 'slashes', 'auth', 'host', 'port', 'hostname', 'hash', 'search', 'query', 'pathname', 'path', 'href'];

/***/ },
/* 71 */
/***/ function(module, exports) {

	module.exports = require("url");

/***/ },
/* 72 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Detect Electron renderer process, which is node, but we should
	 * treat as a browser.
	 */

	if (typeof process !== 'undefined' && process.type === 'renderer') {
	  module.exports = __webpack_require__(73);
	} else {
	  module.exports = __webpack_require__(76);
	}

/***/ },
/* 73 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * This is the web browser implementation of `debug()`.
	 *
	 * Expose `debug()` as the module.
	 */

	exports = module.exports = __webpack_require__(74);
	exports.log = log;
	exports.formatArgs = formatArgs;
	exports.save = save;
	exports.load = load;
	exports.useColors = useColors;
	exports.storage = 'undefined' != typeof chrome && 'undefined' != typeof chrome.storage ? chrome.storage.local : localstorage();

	/**
	 * Colors.
	 */

	exports.colors = ['lightseagreen', 'forestgreen', 'goldenrod', 'dodgerblue', 'darkorchid', 'crimson'];

	/**
	 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
	 * and the Firebug extension (any Firefox version) are known
	 * to support "%c" CSS customizations.
	 *
	 * TODO: add a `localStorage` variable to explicitly enable/disable colors
	 */

	function useColors() {
	  // NB: In an Electron preload script, document will be defined but not fully
	  // initialized. Since we know we're in Chrome, we'll just detect this case
	  // explicitly
	  if (typeof window !== 'undefined' && window && typeof window.process !== 'undefined' && window.process.type === 'renderer') {
	    return true;
	  }

	  // is webkit? http://stackoverflow.com/a/16459606/376773
	  // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
	  return typeof document !== 'undefined' && document && 'WebkitAppearance' in document.documentElement.style ||
	  // is firebug? http://stackoverflow.com/a/398120/376773
	  typeof window !== 'undefined' && window && window.console && (console.firebug || console.exception && console.table) ||
	  // is firefox >= v31?
	  // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
	  typeof navigator !== 'undefined' && navigator && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 ||
	  // double check webkit in userAgent just in case we are in a worker
	  typeof navigator !== 'undefined' && navigator && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
	}

	/**
	 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
	 */

	exports.formatters.j = function (v) {
	  try {
	    return JSON.stringify(v);
	  } catch (err) {
	    return '[UnexpectedJSONParseError]: ' + err.message;
	  }
	};

	/**
	 * Colorize log arguments if enabled.
	 *
	 * @api public
	 */

	function formatArgs(args) {
	  var useColors = this.useColors;

	  args[0] = (useColors ? '%c' : '') + this.namespace + (useColors ? ' %c' : ' ') + args[0] + (useColors ? '%c ' : ' ') + '+' + exports.humanize(this.diff);

	  if (!useColors) return;

	  var c = 'color: ' + this.color;
	  args.splice(1, 0, c, 'color: inherit');

	  // the final "%c" is somewhat tricky, because there could be other
	  // arguments passed either before or after the %c, so we need to
	  // figure out the correct index to insert the CSS into
	  var index = 0;
	  var lastC = 0;
	  args[0].replace(/%[a-zA-Z%]/g, function (match) {
	    if ('%%' === match) return;
	    index++;
	    if ('%c' === match) {
	      // we only are interested in the *last* %c
	      // (the user may have provided their own)
	      lastC = index;
	    }
	  });

	  args.splice(lastC, 0, c);
	}

	/**
	 * Invokes `console.log()` when available.
	 * No-op when `console.log` is not a "function".
	 *
	 * @api public
	 */

	function log() {
	  // this hackery is required for IE8/9, where
	  // the `console.log` function doesn't have 'apply'
	  return 'object' === typeof console && console.log && Function.prototype.apply.call(console.log, console, arguments);
	}

	/**
	 * Save `namespaces`.
	 *
	 * @param {String} namespaces
	 * @api private
	 */

	function save(namespaces) {
	  try {
	    if (null == namespaces) {
	      exports.storage.removeItem('debug');
	    } else {
	      exports.storage.debug = namespaces;
	    }
	  } catch (e) {}
	}

	/**
	 * Load `namespaces`.
	 *
	 * @return {String} returns the previously persisted debug modes
	 * @api private
	 */

	function load() {
	  try {
	    return exports.storage.debug;
	  } catch (e) {}

	  // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
	  if (typeof process !== 'undefined' && 'env' in process) {
	    return process.env.DEBUG;
	  }
	}

	/**
	 * Enable namespaces listed in `localStorage.debug` initially.
	 */

	exports.enable(load());

	/**
	 * Localstorage attempts to return the localstorage.
	 *
	 * This is necessary because safari throws
	 * when a user disables cookies/localstorage
	 * and you attempt to access it.
	 *
	 * @return {LocalStorage}
	 * @api private
	 */

	function localstorage() {
	  try {
	    return window.localStorage;
	  } catch (e) {}
	}

/***/ },
/* 74 */
/***/ function(module, exports, __webpack_require__) {

	
	/**
	 * This is the common logic for both the Node.js and web browser
	 * implementations of `debug()`.
	 *
	 * Expose `debug()` as the module.
	 */

	exports = module.exports = createDebug.debug = createDebug.default = createDebug;
	exports.coerce = coerce;
	exports.disable = disable;
	exports.enable = enable;
	exports.enabled = enabled;
	exports.humanize = __webpack_require__(75);

	/**
	 * The currently active debug mode names, and names to skip.
	 */

	exports.names = [];
	exports.skips = [];

	/**
	 * Map of special "%n" handling functions, for the debug "format" argument.
	 *
	 * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
	 */

	exports.formatters = {};

	/**
	 * Previous log timestamp.
	 */

	var prevTime;

	/**
	 * Select a color.
	 * @param {String} namespace
	 * @return {Number}
	 * @api private
	 */

	function selectColor(namespace) {
	  var hash = 0,
	      i;

	  for (i in namespace) {
	    hash = (hash << 5) - hash + namespace.charCodeAt(i);
	    hash |= 0; // Convert to 32bit integer
	  }

	  return exports.colors[Math.abs(hash) % exports.colors.length];
	}

	/**
	 * Create a debugger with the given `namespace`.
	 *
	 * @param {String} namespace
	 * @return {Function}
	 * @api public
	 */

	function createDebug(namespace) {

	  function debug() {
	    // disabled?
	    if (!debug.enabled) return;

	    var self = debug;

	    // set `diff` timestamp
	    var curr = +new Date();
	    var ms = curr - (prevTime || curr);
	    self.diff = ms;
	    self.prev = prevTime;
	    self.curr = curr;
	    prevTime = curr;

	    // turn the `arguments` into a proper Array
	    var args = new Array(arguments.length);
	    for (var i = 0; i < args.length; i++) {
	      args[i] = arguments[i];
	    }

	    args[0] = exports.coerce(args[0]);

	    if ('string' !== typeof args[0]) {
	      // anything else let's inspect with %O
	      args.unshift('%O');
	    }

	    // apply any `formatters` transformations
	    var index = 0;
	    args[0] = args[0].replace(/%([a-zA-Z%])/g, function (match, format) {
	      // if we encounter an escaped % then don't increase the array index
	      if (match === '%%') return match;
	      index++;
	      var formatter = exports.formatters[format];
	      if ('function' === typeof formatter) {
	        var val = args[index];
	        match = formatter.call(self, val);

	        // now we need to remove `args[index]` since it's inlined in the `format`
	        args.splice(index, 1);
	        index--;
	      }
	      return match;
	    });

	    // apply env-specific formatting (colors, etc.)
	    exports.formatArgs.call(self, args);

	    var logFn = debug.log || exports.log || console.log.bind(console);
	    logFn.apply(self, args);
	  }

	  debug.namespace = namespace;
	  debug.enabled = exports.enabled(namespace);
	  debug.useColors = exports.useColors();
	  debug.color = selectColor(namespace);

	  // env-specific initialization logic for debug instances
	  if ('function' === typeof exports.init) {
	    exports.init(debug);
	  }

	  return debug;
	}

	/**
	 * Enables a debug mode by namespaces. This can include modes
	 * separated by a colon and wildcards.
	 *
	 * @param {String} namespaces
	 * @api public
	 */

	function enable(namespaces) {
	  exports.save(namespaces);

	  var split = (namespaces || '').split(/[\s,]+/);
	  var len = split.length;

	  for (var i = 0; i < len; i++) {
	    if (!split[i]) continue; // ignore empty strings
	    namespaces = split[i].replace(/\*/g, '.*?');
	    if (namespaces[0] === '-') {
	      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
	    } else {
	      exports.names.push(new RegExp('^' + namespaces + '$'));
	    }
	  }
	}

	/**
	 * Disable debug output.
	 *
	 * @api public
	 */

	function disable() {
	  exports.enable('');
	}

	/**
	 * Returns true if the given mode name is enabled, false otherwise.
	 *
	 * @param {String} name
	 * @return {Boolean}
	 * @api public
	 */

	function enabled(name) {
	  var i, len;
	  for (i = 0, len = exports.skips.length; i < len; i++) {
	    if (exports.skips[i].test(name)) {
	      return false;
	    }
	  }
	  for (i = 0, len = exports.names.length; i < len; i++) {
	    if (exports.names[i].test(name)) {
	      return true;
	    }
	  }
	  return false;
	}

	/**
	 * Coerce `val`.
	 *
	 * @param {Mixed} val
	 * @return {Mixed}
	 * @api private
	 */

	function coerce(val) {
	  if (val instanceof Error) return val.stack || val.message;
	  return val;
	}

/***/ },
/* 75 */
/***/ function(module, exports) {

	/**
	 * Helpers.
	 */

	var s = 1000;
	var m = s * 60;
	var h = m * 60;
	var d = h * 24;
	var y = d * 365.25;

	/**
	 * Parse or format the given `val`.
	 *
	 * Options:
	 *
	 *  - `long` verbose formatting [false]
	 *
	 * @param {String|Number} val
	 * @param {Object} options
	 * @throws {Error} throw an error if val is not a non-empty string or a number
	 * @return {String|Number}
	 * @api public
	 */

	module.exports = function (val, options) {
	  options = options || {};
	  var type = typeof val;
	  if (type === 'string' && val.length > 0) {
	    return parse(val);
	  } else if (type === 'number' && isNaN(val) === false) {
	    return options.long ? fmtLong(val) : fmtShort(val);
	  }
	  throw new Error('val is not a non-empty string or a valid number. val=' + JSON.stringify(val));
	};

	/**
	 * Parse the given `str` and return milliseconds.
	 *
	 * @param {String} str
	 * @return {Number}
	 * @api private
	 */

	function parse(str) {
	  str = String(str);
	  if (str.length > 10000) {
	    return;
	  }
	  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str);
	  if (!match) {
	    return;
	  }
	  var n = parseFloat(match[1]);
	  var type = (match[2] || 'ms').toLowerCase();
	  switch (type) {
	    case 'years':
	    case 'year':
	    case 'yrs':
	    case 'yr':
	    case 'y':
	      return n * y;
	    case 'days':
	    case 'day':
	    case 'd':
	      return n * d;
	    case 'hours':
	    case 'hour':
	    case 'hrs':
	    case 'hr':
	    case 'h':
	      return n * h;
	    case 'minutes':
	    case 'minute':
	    case 'mins':
	    case 'min':
	    case 'm':
	      return n * m;
	    case 'seconds':
	    case 'second':
	    case 'secs':
	    case 'sec':
	    case 's':
	      return n * s;
	    case 'milliseconds':
	    case 'millisecond':
	    case 'msecs':
	    case 'msec':
	    case 'ms':
	      return n;
	    default:
	      return undefined;
	  }
	}

	/**
	 * Short format for `ms`.
	 *
	 * @param {Number} ms
	 * @return {String}
	 * @api private
	 */

	function fmtShort(ms) {
	  if (ms >= d) {
	    return Math.round(ms / d) + 'd';
	  }
	  if (ms >= h) {
	    return Math.round(ms / h) + 'h';
	  }
	  if (ms >= m) {
	    return Math.round(ms / m) + 'm';
	  }
	  if (ms >= s) {
	    return Math.round(ms / s) + 's';
	  }
	  return ms + 'ms';
	}

	/**
	 * Long format for `ms`.
	 *
	 * @param {Number} ms
	 * @return {String}
	 * @api private
	 */

	function fmtLong(ms) {
	  return plural(ms, d, 'day') || plural(ms, h, 'hour') || plural(ms, m, 'minute') || plural(ms, s, 'second') || ms + ' ms';
	}

	/**
	 * Pluralization helper.
	 */

	function plural(ms, n, name) {
	  if (ms < n) {
	    return;
	  }
	  if (ms < n * 1.5) {
	    return Math.floor(ms / n) + ' ' + name;
	  }
	  return Math.ceil(ms / n) + ' ' + name + 's';
	}

/***/ },
/* 76 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies.
	 */

	var tty = __webpack_require__(77);
	var util = __webpack_require__(78);

	/**
	 * This is the Node.js implementation of `debug()`.
	 *
	 * Expose `debug()` as the module.
	 */

	exports = module.exports = __webpack_require__(74);
	exports.init = init;
	exports.log = log;
	exports.formatArgs = formatArgs;
	exports.save = save;
	exports.load = load;
	exports.useColors = useColors;

	/**
	 * Colors.
	 */

	exports.colors = [6, 2, 3, 4, 5, 1];

	/**
	 * Build up the default `inspectOpts` object from the environment variables.
	 *
	 *   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
	 */

	exports.inspectOpts = Object.keys(process.env).filter(function (key) {
	  return (/^debug_/i.test(key)
	  );
	}).reduce(function (obj, key) {
	  // camel-case
	  var prop = key.substring(6).toLowerCase().replace(/_([a-z])/, function (_, k) {
	    return k.toUpperCase();
	  });

	  // coerce string value into JS value
	  var val = process.env[key];
	  if (/^(yes|on|true|enabled)$/i.test(val)) val = true;else if (/^(no|off|false|disabled)$/i.test(val)) val = false;else if (val === 'null') val = null;else val = Number(val);

	  obj[prop] = val;
	  return obj;
	}, {});

	/**
	 * The file descriptor to write the `debug()` calls to.
	 * Set the `DEBUG_FD` env variable to override with another value. i.e.:
	 *
	 *   $ DEBUG_FD=3 node script.js 3>debug.log
	 */

	if ('DEBUG_FD' in process.env) {
	  util.deprecate(function () {}, '`DEBUG_FD` is deprecated. Override `debug.log` if you want to use a different log function (https://git.io/vMUyr)')();
	}

	var fd = parseInt(process.env.DEBUG_FD, 10) || 2;
	var stream = 1 === fd ? process.stdout : 2 === fd ? process.stderr : createWritableStdioStream(fd);

	/**
	 * Is stdout a TTY? Colored output is enabled when `true`.
	 */

	function useColors() {
	  return 'colors' in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(fd);
	}

	/**
	 * Map %o to `util.inspect()`, all on a single line.
	 */

	exports.formatters.o = function (v) {
	  this.inspectOpts.colors = this.useColors;
	  return util.inspect(v, this.inspectOpts).replace(/\s*\n\s*/g, ' ');
	};

	/**
	 * Map %o to `util.inspect()`, allowing multiple lines if needed.
	 */

	exports.formatters.O = function (v) {
	  this.inspectOpts.colors = this.useColors;
	  return util.inspect(v, this.inspectOpts);
	};

	/**
	 * Adds ANSI color escape codes if enabled.
	 *
	 * @api public
	 */

	function formatArgs(args) {
	  var name = this.namespace;
	  var useColors = this.useColors;

	  if (useColors) {
	    var c = this.color;
	    var prefix = '  \u001b[3' + c + ';1m' + name + ' ' + '\u001b[0m';

	    args[0] = prefix + args[0].split('\n').join('\n' + prefix);
	    args.push('\u001b[3' + c + 'm+' + exports.humanize(this.diff) + '\u001b[0m');
	  } else {
	    args[0] = new Date().toUTCString() + ' ' + name + ' ' + args[0];
	  }
	}

	/**
	 * Invokes `util.format()` with the specified arguments and writes to `stream`.
	 */

	function log() {
	  return stream.write(util.format.apply(util, arguments) + '\n');
	}

	/**
	 * Save `namespaces`.
	 *
	 * @param {String} namespaces
	 * @api private
	 */

	function save(namespaces) {
	  if (null == namespaces) {
	    // If you set a process.env field to null or undefined, it gets cast to the
	    // string 'null' or 'undefined'. Just delete instead.
	    delete process.env.DEBUG;
	  } else {
	    process.env.DEBUG = namespaces;
	  }
	}

	/**
	 * Load `namespaces`.
	 *
	 * @return {String} returns the previously persisted debug modes
	 * @api private
	 */

	function load() {
	  return process.env.DEBUG;
	}

	/**
	 * Copied from `node/src/node.js`.
	 *
	 * XXX: It's lame that node doesn't expose this API out-of-the-box. It also
	 * relies on the undocumented `tty_wrap.guessHandleType()` which is also lame.
	 */

	function createWritableStdioStream(fd) {
	  var stream;
	  var tty_wrap = process.binding('tty_wrap');

	  // Note stream._type is used for test-module-load-list.js

	  switch (tty_wrap.guessHandleType(fd)) {
	    case 'TTY':
	      stream = new tty.WriteStream(fd);
	      stream._type = 'tty';

	      // Hack to have stream not keep the event loop alive.
	      // See https://github.com/joyent/node/issues/1726
	      if (stream._handle && stream._handle.unref) {
	        stream._handle.unref();
	      }
	      break;

	    case 'FILE':
	      var fs = __webpack_require__(79);
	      stream = new fs.SyncWriteStream(fd, { autoClose: false });
	      stream._type = 'fs';
	      break;

	    case 'PIPE':
	    case 'TCP':
	      var net = __webpack_require__(80);
	      stream = new net.Socket({
	        fd: fd,
	        readable: false,
	        writable: true
	      });

	      // FIXME Should probably have an option in net.Socket to create a
	      // stream from an existing fd which is writable only. But for now
	      // we'll just add this hack and set the `readable` member to false.
	      // Test: ./node test/fixtures/echo.js < /etc/passwd
	      stream.readable = false;
	      stream.read = null;
	      stream._type = 'pipe';

	      // FIXME Hack to have stream not keep the event loop alive.
	      // See https://github.com/joyent/node/issues/1726
	      if (stream._handle && stream._handle.unref) {
	        stream._handle.unref();
	      }
	      break;

	    default:
	      // Probably an error on in uv_guess_handle()
	      throw new Error('Implement me. Unknown stream file type!');
	  }

	  // For supporting legacy API we put the FD here.
	  stream.fd = fd;

	  stream._isStdio = true;

	  return stream;
	}

	/**
	 * Init logic for `debug` instances.
	 *
	 * Create a new `inspectOpts` object in case `useColors` is set
	 * differently for a particular `debug` instance.
	 */

	function init(debug) {
	  debug.inspectOpts = util._extend({}, exports.inspectOpts);
	}

	/**
	 * Enable namespaces listed in `process.env.DEBUG` initially.
	 */

	exports.enable(load());

/***/ },
/* 77 */
/***/ function(module, exports) {

	module.exports = require("tty");

/***/ },
/* 78 */
/***/ function(module, exports) {

	module.exports = require("util");

/***/ },
/* 79 */
/***/ function(module, exports) {

	module.exports = require("fs");

/***/ },
/* 80 */
/***/ function(module, exports) {

	module.exports = require("net");

/***/ },
/* 81 */
/***/ function(module, exports) {

	module.exports = require("assert");

/***/ },
/* 82 */
/***/ function(module, exports) {

	module.exports = function (stream) {
	    if (stream.readable && typeof stream.resume === 'function') {
	        var state = stream._readableState;
	        if (!state || state.pipesCount === 0) {
	            // Either a classic stream or streams2 that's not piped to another destination
	            try {
	                stream.resume();
	            } catch (err) {
	                console.error("Got error: " + err);
	                // If we can't, it's not worth dying over
	            }
	        }
	    }
	};

/***/ },
/* 83 */
/***/ function(module, exports) {

	module.exports = require("zlib");

/***/ },
/* 84 */
/***/ function(module, exports) {

	module.exports = {
		"_args": [
			[
				{
					"raw": "axios@^0.13.1",
					"scope": null,
					"escapedName": "axios",
					"name": "axios",
					"rawSpec": "^0.13.1",
					"spec": ">=0.13.1 <0.14.0",
					"type": "range"
				},
				"/home/vitorfdl/projects/analysis-scheduler"
			]
		],
		"_from": "axios@>=0.13.1 <0.14.0",
		"_id": "axios@0.13.1",
		"_inCache": true,
		"_installable": true,
		"_location": "/axios",
		"_nodeVersion": "3.3.1",
		"_npmOperationalInternal": {
			"host": "packages-12-west.internal.npmjs.com",
			"tmp": "tmp/axios-0.13.1.tgz_1468689204636_0.7909611663781106"
		},
		"_npmUser": {
			"name": "mzabriskie",
			"email": "mzabriskie@gmail.com"
		},
		"_npmVersion": "3.9.5",
		"_phantomChildren": {},
		"_requested": {
			"raw": "axios@^0.13.1",
			"scope": null,
			"escapedName": "axios",
			"name": "axios",
			"rawSpec": "^0.13.1",
			"spec": ">=0.13.1 <0.14.0",
			"type": "range"
		},
		"_requiredBy": [
			"/"
		],
		"_resolved": "https://registry.npmjs.org/axios/-/axios-0.13.1.tgz",
		"_shasum": "3e67abfe4333bc9d2d5fe6fbd13b4694eafc8df8",
		"_shrinkwrap": null,
		"_spec": "axios@^0.13.1",
		"_where": "/home/vitorfdl/projects/analysis-scheduler",
		"author": {
			"name": "Matt Zabriskie"
		},
		"browser": {
			"./lib/adapters/http.js": "./lib/adapters/xhr.js"
		},
		"bugs": {
			"url": "https://github.com/mzabriskie/axios/issues"
		},
		"dependencies": {
			"follow-redirects": "0.0.7"
		},
		"description": "Promise based HTTP client for the browser and node.js",
		"devDependencies": {
			"coveralls": "^2.11.9",
			"es6-promise": "^3.2.1",
			"grunt": "0.4.5",
			"grunt-banner": "0.6.0",
			"grunt-cli": "0.1.13",
			"grunt-contrib-clean": "1.0.0",
			"grunt-contrib-nodeunit": "1.0.0",
			"grunt-contrib-watch": "0.6.1",
			"grunt-eslint": "18.0.0",
			"grunt-karma": "0.12.1",
			"grunt-ts": "5.3.2",
			"grunt-webpack": "1.0.11",
			"istanbul-instrumenter-loader": "^0.2.0",
			"jasmine-core": "^2.4.1",
			"karma": "^0.13.22",
			"karma-chrome-launcher": "^1.0.1",
			"karma-coverage": "^1.0.0",
			"karma-firefox-launcher": "^1.0.0",
			"karma-jasmine": "^1.0.2",
			"karma-jasmine-ajax": "^0.1.13",
			"karma-opera-launcher": "^1.0.0",
			"karma-phantomjs-launcher": "^1.0.0",
			"karma-safari-launcher": "^1.0.0",
			"karma-sauce-launcher": "^1.0.0",
			"karma-sinon": "^1.0.5",
			"karma-sourcemap-loader": "^0.3.7",
			"karma-webpack": "^1.7.0",
			"load-grunt-tasks": "3.4.1",
			"minimist": "^1.2.0",
			"phantomjs-prebuilt": "^2.1.7",
			"sinon": "^1.17.4",
			"url-search-params": "^0.5.0",
			"webpack": "^1.13.1",
			"webpack-dev-server": "^1.14.1"
		},
		"directories": {},
		"dist": {
			"shasum": "3e67abfe4333bc9d2d5fe6fbd13b4694eafc8df8",
			"tarball": "https://registry.npmjs.org/axios/-/axios-0.13.1.tgz"
		},
		"gitHead": "377efb89aed819ed1cd416b69f057632ad5664a5",
		"homepage": "https://github.com/mzabriskie/axios",
		"keywords": [
			"xhr",
			"http",
			"ajax",
			"promise",
			"node"
		],
		"license": "MIT",
		"main": "index.js",
		"maintainers": [
			{
				"name": "mzabriskie",
				"email": "mzabriskie@gmail.com"
			},
			{
				"name": "nickuraltsev",
				"email": "nick.uraltsev@gmail.com"
			}
		],
		"name": "axios",
		"optionalDependencies": {},
		"readme": "ERROR: No README data found!",
		"repository": {
			"type": "git",
			"url": "git+https://github.com/mzabriskie/axios.git"
		},
		"scripts": {
			"build": "NODE_ENV=production grunt build",
			"coveralls": "cat coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js",
			"examples": "node ./examples/server.js",
			"postversion": "git push && git push --tags",
			"preversion": "npm test",
			"start": "node ./sandbox/server.js",
			"test": "grunt test",
			"version": "npm run build && grunt version && git add -A dist && git add CHANGELOG.md bower.json package.json"
		},
		"typescript": {
			"definition": "./axios.d.ts"
		},
		"version": "0.13.1"
	};

/***/ },
/* 85 */
/***/ function(module, exports) {

	module.exports = require("buffer");

/***/ },
/* 86 */
/***/ function(module, exports) {

	'use strict';

	/**
	 * Determines whether the specified URL is absolute
	 *
	 * @param {string} url The URL to test
	 * @returns {boolean} True if the specified URL is absolute, otherwise false
	 */

	module.exports = function isAbsoluteURL(url) {
	  // A URL is considered absolute if it begins with "<scheme>://" or "//" (protocol-relative URL).
	  // RFC 3986 defines scheme name as a sequence of characters beginning with a letter and followed
	  // by any combination of letters, digits, plus, period, or hyphen.
	  return (/^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(url)
	  );
	};

/***/ },
/* 87 */
/***/ function(module, exports) {

	'use strict';

	/**
	 * Creates a new URL by combining the specified URLs
	 *
	 * @param {string} baseURL The base URL
	 * @param {string} relativeURL The relative URL
	 * @returns {string} The combined URL
	 */

	module.exports = function combineURLs(baseURL, relativeURL) {
	  return baseURL.replace(/\/+$/, '') + '/' + relativeURL.replace(/^\/+/, '');
	};

/***/ },
/* 88 */
/***/ function(module, exports) {

	'use strict';

	/**
	 * Syntactic sugar for invoking a function and expanding an array for arguments.
	 *
	 * Common use case would be to use `Function.prototype.apply`.
	 *
	 *  ```js
	 *  function f(x, y, z) {}
	 *  var args = [1, 2, 3];
	 *  f.apply(null, args);
	 *  ```
	 *
	 * With `spread` this example can be re-written.
	 *
	 *  ```js
	 *  spread(function(x, y, z) {})([1, 2, 3]);
	 *  ```
	 *
	 * @param {Function} callback
	 * @returns {Function}
	 */

	module.exports = function spread(callback) {
	  return function wrap(arr) {
	    return callback.apply(null, arr);
	  };
	};

/***/ },
/* 89 */
/***/ function(module, exports) {

	module.exports = require("co");

/***/ }
/******/ ]);