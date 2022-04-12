/*
 * Copyright 2020 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { isUndefined } from 'util'
const _ = require('lodash')
const util = require('util')

export default function (app: any) {
  const error =
    app.error ||
    ((msg: string) => {
      console.error(msg)
    })
  const debug =
    app.debug ||
    ((msg: string) => {
      console.log(msg)
    })

  let lastProps: any
  let unsubscribes: any = []
  let playingNotification: any
  let playingNotificationPath: any
  let activeNotifications: any = {}
  let stateSoundMappings: any
  let statePriorityMapping: any = ['warn', 'alert', 'alarm', 'emergency']

  const plugin: Plugin = {
    start: function (props: any) {
      lastProps = props
      //sendCommand("MODE DS")
      setTimeout(() => {
        sendCommand(`BANK ${props.bank}`)
        setTimeout(() => {
          sendCommand(`VOLUME ${props.volume}`)
        }, 1000)
      }, 5000)

      stateSoundMappings = {
        alert: props.alertSound,
        warn: props.warnSound,
        alarm: props.alarmSound,
        emergency: props.emergencySound
      }

      subscribeToAlarms()
    },

    stop: function () {
      unsubscribes.forEach(function (func: () => void) {
        func()
      })
      unsubscribes = []
    },

    started: false,
    id: 'signalk-yd-alarm-button',
    name: 'YD Alarm Button',
    description:
      'Signal K Plugin To Control And Configure a Yacht Devices TDAB-01',
    schema: {
      type: 'object',
      properties: {
        deviceAddress: {
          type: 'number',
          title: 'N2K Address',
          default: 67
        },
        /*
        mode: {
          type: 'string',
          title: 'Mode',
          enum: [ 'MOB', 'DS', 'ENGINE' ],
          enumNames: ['Man Over Board', 'Digital Switching', 'Engine' ],
          default: 'DS'
        },
        */
        bank: {
          type: 'number',
          title: 'Digital Switching Bank',
          default: 10
        },
        volume: {
          type: 'number',
          title: 'Volume',
          default: 40
        },
        warnSound: {
          type: 'number',
          title: 'Warning Sound',
          description: 'Zero for no sound',
          default: 1
        },
        alertSound: {
          type: 'number',
          title: 'Alert Sound',
          description: 'Zero for no sound',
          default: 1
        },
        alarmSound: {
          type: 'number',
          title: 'Alarm Sound',
          description: 'Zero for no sound',
          default: 1
        },
        emergencySound: {
          type: 'number',
          title: 'Emergency Sound',
          description: 'Zero for no sound',
          default: 1
        },
        mappings: {
          type: 'array',
          title: 'Sounds For Specific Notifications',
          items: {
            type: 'object',
            required: ['notification', 'sound'],
            properties: {
              notification: {
                type: 'string',
                title: 'Notification Path'
              },
              sound: {
                type: 'number',
                title: 'Sound',
                default: 1
              }
            }
          }
        }
      }
    }
  }

  function getSoundForNotification (path:string, notification: any) {
    let mapping =
      lastProps.mappings &&
      lastProps.mappings.find((mapping: any) => {
        return path == mapping.notification
      })
    let sound
    if (mapping) {
      sound = mapping.sound
    } else {
      sound = stateSoundMappings[notification.state]
    }
    return isUndefined(sound) || sound > 28 ? 1 : sound
  }

  function gotDelta (notification: any) {
    let changed = false
    notification.updates.forEach(function (update: any) {
      update.values.forEach(function (value: any) {
        if (
          value.value != null &&
          typeof value.value.state != 'undefined' &&
          typeof value.value.method != 'undefined' &&
          value.value.method.indexOf('sound') != -1
        ) {
          if (
            value.value.state !== 'normal' &&
            value.value.state !== 'nominal'
          ) {
            const sound: number = getSoundForNotification(value.path, value.value)
            if ( sound !== 0 ) {
              activeNotifications[value.path] = value.value
              changed = true
              app.debug('adding %s', value.path)
            }
          } else if (activeNotifications[value.path]) {
            delete activeNotifications[value.path]
            changed = true
            app.debug('removed %s', value.path)
          }
        } else if (activeNotifications[value.path]) {
          delete activeNotifications[value.path]
          app.debug('removed %s', value.path)
          changed = true
        }
      })
    })
    if ( changed ) {
      updateSound()
    }
  }

  function subscribeToAlarms () {
    const command = {
      context: 'vessels.self',
      subscribe: [
        {
          path: 'notifications.*',
          policy: 'instant'
        }
      ]
    }

    app.subscriptionmanager.subscribe(
      command,
      unsubscribes,
      (error: any) => {
        app.error(error)
      },
      gotDelta
    )
  }

  function sendCommand (command: string) {
    const pgn = {
      pgn: 126208,
      PGN: 126998,
      dst: lastProps.deviceAddress,
      'Function Code': 'Command',
      '# of Parameters': 1,
      list: [
        {
          Parameter: 2,
          Value: `YD:${command}`
        }
      ]
    }
    app.debug('send command %j', pgn)
    app.emit('nmea2000JsonOut', pgn)
  }

  function sendAllOff () {
    const pgn: any = {
      pgn: 127502,
      dst: lastProps.deviceAddress,
      'Switch Bank Instance': lastProps.bank,
      "Instance": lastProps.bank
    }

    for (let i: number = 1; i < 29; i++) {
      pgn[`Switch${i}`] = 'Off'
    }
    app.emit('nmea2000JsonOut', pgn)
  }

  function playSound (sound: number) {
    const pgn: any = {
      pgn: 127502,
      dst: lastProps.deviceAddress,
      'Switch Bank Instance': lastProps.bank,
      "Instance": lastProps.bank
    }
    
    for (let i: number = 1; i < 29; i++) {
      pgn[`Switch${i}`] = i == sound ? 'On' : 'Off'
    }
    app.emit('nmea2000JsonOut', pgn)
  }

  function updateSound() {
    if (_.keys(activeNotifications).length == 0) {
      app.debug('Stopping sound')
      sendAllOff()
      playingNotification = undefined
    } else {
      let maxState : any
      let maxNotif : any
      let maxPath : any
      _.keys(activeNotifications).forEach((path:string) => {
        const state = activeNotifications[path].state
        const prio = statePriorityMapping.indexOf(state)
        if ( isUndefined(maxState) || prio > maxState ) {
          maxState = prio
          maxNotif = activeNotifications[path]
          maxPath = path
        }
      })
      const sound: number = getSoundForNotification(maxPath, maxNotif)
      const playingSound = playingNotification ? getSoundForNotification(playingNotificationPath, playingNotification) : undefined

      if (
        !playingNotification || playingSound != sound
      ) {
        app.debug('Playing sound %d', sound)
        playSound(sound)
        playingNotification = maxNotif
        playingNotificationPath = maxPath
      }
    }
  }

  return plugin
}

interface Plugin {
  start: (app: any) => void
  started: boolean
  stop: () => void
  id: string
  name: string
  description: string
  schema: any
}
