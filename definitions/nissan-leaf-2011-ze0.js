const whPerGid = 80;
const kmPerKwh = 6.2; // original = 7.1

const newBatteryCapacity = 24;
const maxSocPercent = 95;

module.exports = {
  name: "Nissan Leaf 2011 (ZE0)",
  getStatus: (metrics) => {
    // This function is called by the application periodically to get information about the vehicle.

    // Currently, the application only calls this to see if you're moving (for the gps).
    // If you're not using a gps or don't have this information, you should just return {moving:true}.
    const speedMetric = metrics.get("wheel_speed");

    return {
      // Check that at least one value in the wheel_speed metric is above 0.
      moving: speedMetric ? speedMetric.state.some(v => v > 0) : false
    };
  },
  topics: [
    {
      id: 0x11a,
      name: "Shift Controller",
      metrics: [
        {
          id: "gear",
          process: (data) => [ (data[0] & 0xF0) >> 4 ]
        },
        {
          id: "powered",
          process: (data) => [ (data[1] & 0x40) >> 6 ],
          onChange: (state, vehicle) => {
            if (state[0] == 1) {
              vehicle.tripManager.startTrip(vehicle);
            } else {
              vehicle.tripManager.endTrip();
            }
          }
        },
        {
          id: "eco",
          process: (data) => [ (data[1] & 0x10) >> 4 ],
        }
      ]
    },
    {
      id: 0x5bc,
      name: "Lithium Battery Controller (500ms)",
      metrics: [
        {
          id: "soc_gids",
          process: (data) => {
            const gids = (data[0] << 2) | (data[1] >> 6);
            
            // Gids shows as 1023 on startup; this is incorrect so we ignore it.
            if (gids >= 1000) return null;

            return [gids];
          }
        },
        {
          id: "soh",
          suffix: "%",
          process: (data) => [ (data[4] & 0xFE) >> 1 ] 
        },
      ]
    },
    {
      id: 0x1db,
      name: "Lithium Battery Controller (10ms)",
      metrics: [
        {
          id: "power_output",
          cooldown: 80,
          suffix: " kW",
          precision: 2,
          lerp: true,
          process: (data) => {
            const voltage = ((data[2] << 2) | (data[3] >> 6)) / 2.0;
            let current = ((data[0] << 3) | (data[1] & 0xe0) >> 5);
            
            // 0x0400 = 10000000000 (11 bits)
            // 0x7FF  = 11111111111 (11 bits)

            // 1 -> check if byte is negative by checking sign bit
            // 2 -> invert the byte and apply a mask for the first 11 bits (js numbers are 32-bit)
            // 3 -> minus 1 for 2's complement
            
            if (current & 0x0400) current = -(~current & 0x7FF)-1
            current = -current / 2.0;
            
            const power = (current * voltage)/1000;
            
            // The car seems to report an invalid value during startup. This check ignores
            // any values that are above 100 or below -100.
            if (power > 100 || power < -100) return null;
            
            return [power];
          },
        }
      ]
    },
    {
      id: 0x55b,
      name: "Lithium Battery Controller (10ms)",
      metrics: [
        {
          id: "soc_percent",
          suffix: "%",
          process: (data) => {
            return [ ((data[0] << 2) | (data[1] >> 6)) / 10.0 ];
          }
        }
      ]
    },
    {
      id: 0x1d4,
      name: "Vehicle Control Module (10ms)",
      metrics: [
        {
          id: "plugged_in",
          process: (data, vehicle) => {
            const val = (data[6] & 0xE0);
            const pluggedIn = val == 192 || val == 224 ? 1 : 0;
            return [pluggedIn];
          },
          onChange: (state, vehicle) => {
            // Reset gps distance when car is plugged in.
            if (state[0] == 1) {
              const tripDistance = vehicle.metrics.get("gps_distance");
              if (tripDistance) tripDistance.setState([0]);
            }
          }
        }
      ]
    },
    {
      id: 0x284,
      name: "ABS Module",
      metrics: [
        {
          id: "wheel_speed",
          precision: 2,
          cooldown: 100,
          defaultState: [0, 0, 0],
          process: (data) => [ 
            ((data[4] << 8) | data[5]) / 100, // rear
            ((data[2] << 8) | data[3]) / 208, // left
            ((data[0] << 8) | data[1]) / 208 // right
          ]
        },
      ]
    },
    {
      id: 0x5C0,
      name: "Lithium Battery Controller (500ms)",
      metrics: [
        {
          id: "battery_temp",
          process: (data) => {
            // Battery Temperature as reported by the LBC. Effectively has only
            // 7-bit precision, as the bottom bit is always 0.
            if ( (data[0] >> 6) == 1 ) {
              return [ (data[2] / 2) - 40 ];
            }
          }
        }
      ]
    },
    {
      id: 0x55a,
      name: "Inverter (100ms)",
      metrics: [
        {
          id: "motor_temp",
          suffix: "°C",
          precision: 2,
          process: (data) => [ (5.0 / 9.0) * (data[1] - 32) ],
        },
        {
          id: "inverter_temp",
          suffix: "°C",
          precision: 2,
          process: (data) => [ (5.0 / 9.0) * (data[2] - 32) ],
        }
      ]
    },
    {
      id: 0x54c,
      name: "AC Auto Amp (100ms)",
      metrics: [
        {
          id: "ambient_temp",
          suffix: "°C",
          process: (data) => {
            // if the byte is 11111111, then the temperature is invalid.
            if (data[6] == 0xff) return null;
            return [ (data[6]) / 2.0 - 40 ];
          },
        }
      ]
    },
    {
      id: 0x54b,
      name: "AC Auto Amp (100ms)",
      metrics: [
        {
          id: "cc_fan_speed",
          timeout: 1000,
          process: (data) => [ (data[4] & 0xF8) / 8 ]
        }
      ]
    }
  ],
  extraMetrics: [
    {
      id: "range",
      suffix: "km",
      dependencies: ["soc_gids"],
      process: (data, vehicle) => {
        const gids = vehicle.metrics.get("soc_gids").state[0];
        
        // Range Calculation
        // - Division is to convert Wh to kWh
        // - Minus 1.15kWh is reserved energy that cannot be used.
        let energyKwh = ((gids*whPerGid)/1000.0)-1.15;
        if (energyKwh < 0) energyKwh = 0;

        const range = Math.round(energyKwh*kmPerKwh);
        return [range];
      }
    },
    {
      id: "range_at_last_charge",
      suffix: "km",
      dependencies: ["plugged_in", "gear"],
      process: (data, vehicle, currentState) => {
        const pluggedIn = vehicle.metrics.get("plugged_in").state[0] == 1;
        if (pluggedIn) return [0];

        const parked = vehicle.metrics.get("gear").state[0] <= 1;
        if (parked) return null;

        const range = vehicle.metrics.get("range").state[0];
        if (currentState[0] == 0) return [range];
      }
    },
    {
      id: "charge_status",
      dependencies: ["plugged_in", "power_output"],
      process: (data, vehicle, currentState) => {
        const pluggedIn = vehicle.metrics.get("plugged_in").state[0] == 1;
        if (!pluggedIn) return [0];

        const powerInput = -vehicle.metrics.get("power_output").state[0];

        if (powerInput >= 1) return [1];
        else if (powerInput <= 0 && currentState[0] == 1) return [2];
      }
    },
    {
      id: "remaining_charge_time",
      suffix: "minutes",
      dependencies: ["charge_status", "power_output", "soc_percent", "soh"],
      cooldown: 5000,
      process: (data, vehicle) => {
        const charging = vehicle.metrics.get("charge_status").state[0] == 1;
        if (!charging) return [0];
        
        const powerInput = -vehicle.metrics.get("power_output").lerpedState[0];
        if (powerInput <= 0) return [0];

        const soc = vehicle.metrics.get("soc_percent").state[0];
        const soh = vehicle.metrics.get("soh").state[0];
        
        const batteryCapacity = newBatteryCapacity * (soh/100);
        
        const percentUntilFull = Math.max(maxSocPercent - soc, 0);
        
        const energyRequired = batteryCapacity * (percentUntilFull/100);
        const chargeTimeHours = energyRequired / powerInput;
        const chargeTimeMinutes = Math.round(chargeTimeHours * 60);
        
        return [chargeTimeMinutes];
      }
    }
  ]
}