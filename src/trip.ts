import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import logger from "./util/logger";
import Metric from "./metric";
import Vehicle from "./vehicle";

const MAX_LOADED_KEYFRAMES = 150;
const WRITE_BUFFER_SIZE = 100;

export default class TripManager {
  public rFile?: RecordingFile;
  public recording: boolean;
  public playing: boolean;

  public playbackLoop?: NodeJS.Timer;

  private lastUpdateTime: number;
  
  constructor() {
    this.recording = false;
    this.playing = false;
  }

  public async startTrip(vehicle: Vehicle) {
    if (!vehicle.app.config.record || this.rFile) return;
    
    const timeMs = Date.now();
    await this.setFilePath(vehicle.app.paths.recordings, `${timeMs}.log`);

    const metricsArray = Array.from(vehicle.metrics.values());
    const metricsHeader = metricsArray.map(m => m.definition.id).join(',');

    this.rFile.write(`${timeMs}\n${metricsHeader}\n`);
    this.recording = true;
    this.playing = false;

    // Add an entry for every metric so they start on the correct value.
    vehicle.metrics.forEach(metric => {
      //metric.setValue(0, true);
      this.addEntry(metric);
    });
  }

  public async setFilePath(directoryPath: string, fileName: string) {
    const fullPath = path.resolve(directoryPath, fileName);
    logger.info('trip', `File set to ${fileName}`);
    
    // If a file is already loaded then close any streams and set the file
    // property to null.
    if (this.rFile) this.endTrip();

    await fs.promises.mkdir(directoryPath, {recursive: true});
    this.rFile = new RecordingFile(fullPath);
  }

  public addEntry(metric: Metric) {
    if (this.rFile && this.recording) {
      const timeOffset = Date.now() - this.rFile.startTime;
      this.rFile.write(`${timeOffset} ${metric.index} ${metric.value}\n`);
    }
  }

  public async startPlayback(vehicle: Vehicle, timePosition?: number) {
    if (!this.rFile) return;

    this.playing = true;

    if (timePosition != null) {
      this.rFile.timePosition = timePosition;
    }

    await this.rFile.load();

    this.playbackLoop = setInterval(() => {
      this.updatePlayback(vehicle);
    }, 50);
  }

  private updatePlayback(vehicle: Vehicle) {
    if (this.lastUpdateTime) {
      const deltaTime = Date.now() - this.lastUpdateTime;
      this.rFile.timePosition += deltaTime;
    }

    this.rFile.update(vehicle);
    this.lastUpdateTime = Date.now();
  }

  public stopPlayback() {
    if (this.playbackLoop) {
      clearInterval(this.playbackLoop);
    }
    this.playing = false;
  }

  public endTrip() {
    this.recording = false;
    this.stopPlayback();

    if (this.rFile) {
      this.rFile.close();
      this.rFile = null;
    }
  }
}

class RecordingFile {
  public path: string;
  public data?: RecordingData;

  public startTime: number;
  public timePosition: number;

  private wStream?: fs.WriteStream;

  /**
   * This buffer is used to decrease the rate of file writes for hopefully
   * a better SD card life.
   */
  private wBuffer: string;

  constructor(path: string) {
    this.path = path;
    this.startTime = Date.now();
    this.wBuffer = "";
    this.timePosition = 0;
  }

  /**
   * Reads the file and parses the content to get the next chunk of keyframes.
   */
  public async load(): Promise<void> {
    return new Promise((resolve) => {
      this.data = { keyframes: [] };

      const lineReader = readline.createInterface({
        input: fs.createReadStream(this.path),
      });
      
      let i = 0;
  
      lineReader.on('line', (line) => {
        if (i == 0) {
          this.startTime = parseInt(line);
        } else if (i == 1) {
          this.data.metricIds = line.split(',');
        } else {
          if (this.data.keyframes.length >= MAX_LOADED_KEYFRAMES) return;

          const lineSpilt = line.split(' ');
          const timeOffset = parseInt(lineSpilt[0]);
          
          if (timeOffset >= this.timePosition) {
            const metricIndex = parseInt(lineSpilt[1]);
            const value = parseFloat(lineSpilt[2]);

            this.data.keyframes.push({
              timeOffset: timeOffset,
              metricId: this.data.metricIds[metricIndex],
              value: value
            });
          }
        }
        i++;
      });

      lineReader.on('close', () => {
        // If we didn't get any more keyframes then go back to the start (loop).
        if (this.data.keyframes.length == 0) {
          this.timePosition = 0;
        }
        resolve();
      });
    });
  }

  public update(vehicle: Vehicle) {
    for (let i = 0; i < this.data.keyframes.length; i++) {
      const keyframe = this.data.keyframes[i];
     
      if (this.timePosition >= keyframe.timeOffset) {
        const metric = vehicle.metrics.get(keyframe.metricId);
        if (metric) metric.setValue(keyframe.value, true);

        // Remove the keyframe from the array and decrement i as everything to
        // the right has been shifted down by one index.
        this.data.keyframes.splice(i, 1);
        i--;
      }
    }
    
    // If we've ran out of loaded keyframes then load the next set.
    if (this.data.keyframes.length == 0) {
      this.load();
    }
  }

  public write(data: string) {
    this.wBuffer += data;
    
    // If buffer size exceeds 100 chars (100 bytes) then write buffer to file.
    if (this.wBuffer.length >= WRITE_BUFFER_SIZE) {
      this.writeBuffer();
    }
  }

  private writeBuffer() {
    if (!this.wStream) {
      this.wStream = fs.createWriteStream(this.path, {flags: 'a'});
    }

    this.wStream.write(this.wBuffer);
    this.wBuffer = "";
  }

  public close() {
    if (this.wStream) {
      this.writeBuffer();
      this.wStream.close();
    }
  }
}

interface RecordingData {
  metricIds?: string[];
  keyframes?: RecordingKeyframe[];
}

interface RecordingKeyframe {
  timeOffset: number;
  metricId: string;
  value: number;
}