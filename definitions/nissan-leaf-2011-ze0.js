module.exports = {
  name: 'Nissan Leaf 2011 (ZE0)',
  /*
  getInfo: (metrics) => {
    // This function is called by the application periodically to get information about the vehicle.

    // Currently, the application only calls this to see if you're moving (for the gps).
    // If you're not using a gps or don't have this information, you should just return {moving:true}.

    let info = {};

    let speed = metrics.get('rear_speed');
    info.moving = speed && speed.value > 0 ? true : false;

    return info;
  },
  */
  topics: [
    {
      id: 0x11a,
      name: 'Shift Controller',
      metrics: [
        {
          id: 'gear',
          process: (data) => (data[0] & 0xF0) >> 4,
        },
        {
          id: 'powered',
          process: (data) => (data[1] & 0x40) >> 6,
        },
        {
          id: 'eco',
          process: (data) => (data[1] & 0x10) >> 4,
        }
      ]
    },
    {
      id: 0x5bc,
      name: 'Lithium Battery Controller (500ms)',
      metrics: [
        {
          id: 'soc_gids',
          process: (data) => (data[0] << 2) | (data[1] >> 6)
        },
        {
          id: 'soh',
          suffix: '%',
          process: (data) => (data[4] & 0xFE) >> 1 
        }
      ]
    },
    {
      id: 0x1db,
      name: 'Lithium Battery Controller (10ms)',
      metrics: [
        {
          id: 'power',
          rateLimit: 80,
          suffix: ' kW',
          precision: 2,
          process: (data) => {
            let voltage = ((data[2] << 2) | (data[3] >> 6)) / 2.0;
            let current = ((data[0] << 3) | (data[1] & 0xe0) >> 5);
            
            // 0x0400 = 10000000000 (11 bits)
            // 0x7FF  = 11111111111 (11 bits)

            // 1 -> check if byte is negative by checking sign bit
            // 2 -> invert the byte and apply a mask for the first 11 bits (js numbers are 32-bit)
            // 3 -> minus 1 for 2's complement
            
            if (current & 0x0400) current = -(~current & 0x7FF)-1
            current = current / 2.0;
            
            let power = (current * voltage)/1000.0;
            
            return power;
          },
          //convert: (value) => new Uint16Array([value*100])
        }
      ]
    },
    {
      id: 0x55b,
      name: 'Lithium Battery Controller (10ms)',
      metrics: [
        {
          id: 'soc_percent',
          suffix: '%',
          process: (data) => ((data[0] << 2) | (data[1] >> 6)) / 10.0,
          //convert: (value) => new Uint16Array([value*100])
        }
      ]
    },
    {
      id: 0x1d4,
      name: 'Vehicle Control Module (10ms)',
      metrics: [
        {
          //id: 9,
          id: 'charging',
          process: (data) => {
            let val = (data[6] & 0xE0);
            return val == 192 || val == 224 ? 1 : 0
          }
        }
      ]
    },
    {
      id: 0x284,
      name: 'ABS Module',
      metrics: [
        {
          id: 'left_speed',
          rateLimit: 150,
          process: (data) => ((data[2] << 8) | data[3]),
          //convert: (value) => new Uint16Array([value])
        },
        {
          id: 'right_speed',
          rateLimit: 150,
          process: (data) => ((data[0] << 8) | data[1]),
          //convert: (value) => new Uint16Array([value])
        },
        {
          id: 'rear_speed',
          suffix: ' km/h',
          precision: 2,
          //log: true,
          rateLimit: 80,
          // Increased division from 100 to 101 to decrease speed a bit.
          process: (data) => ((data[4] << 8) | data[5]) / 101
        },
      ]
    },
    {
      id: 0x55a,
      name: 'Inverter (100ms)',
      metrics: [
        {
          id: 'motor_temp',
          suffix: '°C',
          precision: 2,
          process: (data) => 5.0 / 9.0 * (data[1] - 32),
          //convert: (value) => new Uint16Array([value*100])
        },
        {
          id: 'inverter_temp',
          suffix: '°C',
          precision: 2,
          process: (data) => 5.0 / 9.0 * (data[2] - 32),
          //convert: (value) => new Uint16Array([value*100])
        }
      ]
    },
    {
      id: 0x54c,
      name: 'Climate',
      metrics: [
        {
          id: 'ambient_temp',
          suffix: '°C',
          process: (data) => {
            // if the byte is 11111111, then the temperature is invalid.
            if (data[6] == 0xff) return null;
            return (data[6]) / 2.0 - 40;
          },
          //convert: (value) => new Uint16Array([value*100])
        }
      ]
    },
    {
      id: 0x54b,
      name: 'Climate',
      metrics: [
        {
          id: 'climate_fan_speed',
          process: (data) => (data[4] & 0xF0) / 8
        }
      ]
    }
  ]
}