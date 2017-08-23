'use strict';

const Analysis = require('tago/analysis');
const Utils = require('tago/utils');
const Service = require('tago/services');
const Device = require('tago/device');
const converter = require('json-2-csv');
const axios = require('axios');
const co = require('co');
const url_node = require('url');

function check_url(url) {
    if (url.indexOf('docs.google.com') === -1 && url.indexOf('spreadsheets') === -1) return url;
    const parse_url = url_node.parse(url);
    let pathname = parse_url.pathname.split("/");
    pathname = pathname.find(x => x.length >= 25); //need to improve this logic?

    url = `https://spreadsheets.google.com/feeds/download/spreadsheets/Export?key=${pathname}&exportFormat=csv`;
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
            resolve(result);
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

function checkIsNumber(value) {
    let number = Number(value);
    if (Number.isNaN(number)) return value;
    else return value = number;
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
        const request = yield axios.get(url);
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
            value = checkIsNumber(value);
            let data_to_insert = {
                "variable": variable,
                "value": value,
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

module.exports = new Analysis(run_scheduler, '933386e0-6660-11e6-b31b-3b9e8e051cf6');




"use strict";
const Analysis = require('tago/analysis');
const Device   = require('tago/device');
const Utils    = require('tago/utils');
const co       = require('co');
const Account  = require('tago/account');

/** Get token of a device id by it's name
 * @param  {Class|Object} account
 * @param  {string} device_id
 * @param  {string} name
 */
function getTokenByName(account, device_id, names) {
    return new Promise((resolve, reject) => {
        co(function*() {
            const tokens = yield account.devices.tokenList(device_id);
            if (!tokens || !tokens[0]) return resolve();
            let token;

            if (names) {
                names = Array.isArray(names) ? names : [names];
                names.forEach((name) => {
                    if (token) return;
                    token = tokens.find((token) => token.name.indexOf(name) >= 0);
                });
            } else {
                token = tokens[0];
            }

            if (!token) return reject(`Não foi encontrado token para ${device_id} com filtro de ${names}`);
            resolve(token.token);
        }).catch(reject);
    });
}

function hex2bin(hex) {
    const bin_values = {
  '0': '0000',
  '1': '0001',
  '2': '0010',
  '3': '0011',
  '4': '0100',
  '5': '0101',
  '6': '0110',
  '7': '0111',
  '8': '1000',
  '9': '1001',
  'a': '1010',
  'b': '1011',
  'c': '1100',
  'd': '1101',
  'e': '1110',
  'f': '1111',
  'A': '1010',
  'B': '1011',
  'C': '1100',
  'D': '1101',
  'E': '1110',
  'F': '1111'
};
    let binary = '';
    for (let i = 0; i < hex.length; i++) {
        binary += bin_values[hex[i]];
    }
    return binary;
}

function sliceMsg(msg, start, end) {
    const sliced_msg = msg.substring(start, end);
    return sliced_msg;
}

function bin2dec(num) {
    return Number(parseInt(num, 2).toString(10));
}

function insertDigit(pulse, digits) {
    digits = Number(digits);
    const pulse_final = pulse.substr(-digits);
    const pulse_init  = pulse.substring(0, pulse.length - digits);
    const pulse_digit = `${pulse_init}.${pulse_final}`;
    return Number(pulse_digit);
}

function parse(context, scope) {
    const env_var = Utils.env_to_obj(context.environment);
    if (!env_var.acc_token) return context.log("Não foi encontrado o parâmetro acc_token nas variaveis de ambiente");
    context.log('Parse started!');

    const data = !scope[0] ? null : scope.find(x => x.variable === "data");
    data.value = String(data.value);

    if (!data) {
        return context.log('Does\'t exist data variable on scope');
    }
    if (data.value === 'ffffffffffffffffffffffff') {
      co(function*() {
        const myaccount = new Account(env_var.acc_token);
        const device_token = yield getTokenByName(myaccount, data.origin, ['generic', 'parse', 'Default']);
        if (!device_token) return context.log(`Não foi possível pegar o token para o origin ${data.origin}`);
        const mydevice = new Device(device_token);
        yield mydevice.insert({ "variable": "download_mode", "value": "ON", "serie": data.serie, "time":data.time }).then(context.log);
      }).catch(context.log);
      return context.log('Download mode on');
    }
    const bin_msg = hex2bin(data.value);
    const battery_status_bin  = sliceMsg(bin_msg, 0, 4);
    const pulse_1_bin         = sliceMsg(bin_msg, 4, 32);
    const pulse_2_bin         = sliceMsg(bin_msg, 32, 60);
    const pulse_3_bin         = sliceMsg(bin_msg, 60, 88);
    const pulse_1_digits_bin  = sliceMsg(bin_msg, 88, 90);
    const pulse_2_digits_bin  = sliceMsg(bin_msg, 90, 92);
    const pulse_3_digits_bin  = sliceMsg(bin_msg, 92, 94);
    const power_save_bin      = sliceMsg(bin_msg, 94, 95);
    const alarm_detection_bin = sliceMsg(bin_msg, 95, 96);

    const battery_status  = bin2dec(battery_status_bin);
    const power_save      = bin2dec(power_save_bin);
    const alarm_detection = bin2dec(alarm_detection_bin);

    let pulse_1_dec = bin2dec(pulse_1_bin);
    let pulse_2_dec = bin2dec(pulse_2_bin);
    let pulse_3_dec = bin2dec(pulse_3_bin);

    const pulse_1_digits_dec  = bin2dec(pulse_1_digits_bin);
    const pulse_2_digits_dec  = bin2dec(pulse_2_digits_bin);
    const pulse_3_digits_dec  = bin2dec(pulse_3_digits_bin);

    if (pulse_1_dec.length > Number(pulse_1_digits_dec)) pulse_1_dec = insertDigit(pulse_1_dec, Number(pulse_1_digits_dec));
    if (pulse_2_dec.length > Number(pulse_2_digits_dec)) pulse_2_dec = insertDigit(pulse_2_dec, Number(pulse_2_digits_dec));
    if (pulse_3_dec.length > Number(pulse_3_digits_dec)) pulse_3_dec = insertDigit(pulse_3_dec, Number(pulse_3_digits_dec));

    co(function*() {
        const myaccount = new Account(env_var.acc_token);
        const device_token = yield getTokenByName(myaccount, data.origin, ['generic', 'parse', 'Default']);
        if (!device_token) return context.log(`Não foi possível pegar o token para o origin ${data.origin}`);
        const mydevice = new Device(device_token);

        yield mydevice.insert([{
            "variable": "battery_status",
            "value": battery_status,
            "serie": data.serie,
            "time":data.time
        }, {
            "variable": "power_save",
            "value": power_save === 1 ? 'ON' : 'OFF',
            "serie": data.serie,
            "time":data.time
        }, {
            "variable": "alarm_detection",
            "value": alarm_detection,
            "serie": data.serie,
            "time":data.time
        }, {
            "variable": "pulse1",
            "value": pulse_1_dec,
            "serie": data.serie,
            "time":data.time
        }, {
            "variable": "pulse2",
            "value": pulse_2_dec,
            "serie": data.serie,
            "time":data.time
        }, {
            "variable": "pulse3",
            "value": pulse_3_dec,
            "serie": data.serie,
            "time":data.time
        }, {
            "variable": "downlond_mode",
            "value": "OFF",
            "serie": data.serie,
            "time":data.time
        }]).then(context.log);
    }).catch(context.log);

    context.log('Parse finished!');
}
module.exports = new Analysis(parse, 'dab30b3f-49b4-46b5-866d-421f7251c637');
