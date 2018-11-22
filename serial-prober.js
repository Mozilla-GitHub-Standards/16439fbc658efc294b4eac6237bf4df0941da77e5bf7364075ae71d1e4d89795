/**
 *
 * serial-prober - Support code for opening/probing a serial port.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const SerialPort = require('serialport');

let DEBUG = false;

const MAX_OPEN_ATTEMPTS = 5;

class SerialProber {

  constructor(params) {
    this.param = params;
  }

  static debug(flag) {
    DEBUG = flag;
  }

  // Opens the serial port and if succesful, calls this.probe to
  // see if this serial port is connected to the type of device.
  // Returns a promise which resolves to the opened serial port
  // object.
  open(portName) {
    DEBUG && console.log('Probing', portName,
                         'at', this.param.baudRate,
                         'for', this.param.name);
    this.portName = portName;
    this.lockAttempt = 0;
    return new Promise((resolve, reject) => {
      this.tryToOpen(resolve, reject);
    }).catch((err) => {
      this.close();
      // rethrow the error so that the next .catch will pick it up.
      throw err;
    });
  }

  tryToOpen(resolve, reject) {
    DEBUG && console.log('SerialProber: Opening', this.portName,
                         'at', this.param.baudRate, 'baud');
    this.serialPort = new SerialPort(this.portName, {
      baudRate: this.param.baudRate,
      lock: true,
    }, (err) => {
      if (err) {
        if (err.message.includes('Cannot lock port')) {
          DEBUG && console.log(`SerialProber: ${this.portName} locked.`);
          this.lockAttempt++;
          if (this.lockAttempt >= MAX_OPEN_ATTEMPTS) {
            // Looks like somebody else has the port open.
            reject(err);
          } else {
            this.lockTimer = setTimeout(() => {
              this.tryToOpen(resolve, reject);
            }, 1000);
          }
        } else {
          // Some other error (like access denied, etc.)
          reject(err);
        }
        return;
      }
      DEBUG && console.log(`SerialProber: Probing ${this.portName} ...`);
      this.probe().then(() => {
        DEBUG && console.log('SerialProber: Probe successful');
        resolve(this.serialPort);
      }).catch((err) => {
        reject(err);
      });
    });
  }

  close() {
    if (this.serialPort && this.serialPort.isOpen) {
      DEBUG && console.log(`SerialProber: closing ${this.portName}`);
      this.serialPort.close();
      this.serialPort = null;
      this.portName = null;
    }
  }

  // Does the actual probe, returning a promise which resolves if the probe
  // was successful.
  //
  // The default probe will send out this.param.probeCmd and looks for
  // this.param.probeRsp within 1/2 second.
  //
  // This function could be overridden by a derived class if a more exotic
  // probe function is needed.
  probe() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const msg = `SerialProber: timeout: ${this.param.name} ` +
                    `dongle not detected on ${this.portName}`;
        DEBUG && console.log(msg);
        reject(msg);
      }, 500);

      const match = Buffer.from(this.param.probeRsp);
      let data = Buffer.from([]);
      this.serialPort.on('data', (chunk) => {
        DEBUG && console.log('SerialProber: Rcvd:', chunk);
        data = Buffer.concat([data, chunk]);
        if (data.includes(match)) {
          clearTimeout(timer);
          resolve();
        }
      });

      // Send out the probe command
      const probeCmd = Buffer.from(this.param.probeCmd);
      DEBUG && console.log('SerialProber: Sent:', probeCmd);
      this.serialPort.write(probeCmd);
    });
  }

  // For each serial port found in SerialPort.list(), apply a filter.
  // The filter is expected to be an array of objects, where each filter
  // object contains keys and regular expressions (or strings).
  //
  // The regular expressions associated with each key will be applied
  // against the same property from serial port object, and if the
  // regular expression for all of the properties match then the serial
  // port will be probed, and if the probe passes it will be included in
  // the results.
  //
  // Returns a promise which resolves to an array of open serial port
  // objects.
  async probeAll() {
    const serialPorts = [];
    const ports = await SerialPort.list();
    for (const port of ports) {
      // Under OSX, SerialPort.list returns the /dev/tty.usbXXX instead
      // /dev/cu.usbXXX. tty.usbXXX requires DCD to be asserted which
      // isn't necessarily the case for all serial dongles. The cu.usbXXX
      // doesn't care about DCD.
      if (port.comName.startsWith('/dev/tty.usb')) {
        port.comName = port.comName.replace('/dev/tty', '/dev/cu');
      }
      if (this.serialPortMatchesFilter(port)) {
        try {
          const serialPort = await this.open(port.comName);
          // probe passed.
          serialPorts.push({
            prober: this,
            port: port,
            serialPort: serialPort,
          });
        } catch (err) {
          // probe failed.
        }
      }
    }
    return serialPorts;
  }

  serialPortMatchesFilter(port) {
    // Under OSX, SerialPort.list returns the /dev/tty.usbXXX instead
    // /dev/cu.usbXXX. tty.usbXXX requires DCD to be asserted which
    // isn't necessarily the case for usb-to-serial dongles.
    // The cu.usbXXX doesn't care about DCD.
    if (port.comName.startsWith('/dev/tty.usb')) {
      port.comName = port.comName.replace('/dev/tty', '/dev/cu');
    }
    for (const filter of this.param.filter) {
      let match = true;
      for (const [key, re] of Object.entries(filter)) {
        if (!port.hasOwnProperty(key)) {
          match = false;
          break;
        }
        if (typeof port[key] !== 'string') {
          match = false;
          break;
        }
        if (!port[key].match(re)) {
          match = false;
          break;
        }
      }
      if (match) {
        return true;
      }
    }
    return false;
  }
}

module.exports = SerialProber;