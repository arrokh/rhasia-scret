export interface ServerTimePort {
  now(): Promise<Date>;
}
