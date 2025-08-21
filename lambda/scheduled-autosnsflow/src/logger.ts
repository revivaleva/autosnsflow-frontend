// ログ管理と通知機能
import { postDiscord } from "@autosnsflow/backend-core";
import { ScheduledTaskConfig } from "./config";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  userId?: string;
  data?: any;
  error?: Error;
}

export class Logger {
  private config: ScheduledTaskConfig;
  private logs: LogEntry[] = [];

  constructor(config: ScheduledTaskConfig) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    const configLevel = LogLevel[this.config.logging.level.toUpperCase() as keyof typeof LogLevel];
    return level >= configLevel;
  }

  private formatLog(entry: LogEntry): string {
    const levelStr = LogLevel[entry.level];
    const timestamp = entry.timestamp;
    const userId = entry.userId ? `[${entry.userId}]` : '';
    const data = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    const error = entry.error ? ` | Error: ${entry.error.message}` : '';
    
    return `[${levelStr}] ${timestamp} ${userId} ${entry.message}${data}${error}`;
  }

  private async sendDiscordLog(entry: LogEntry): Promise<void> {
    if (!this.config.logging.enableDiscordLog || !this.config.masterDiscordWebhook) {
      return;
    }

    try {
      const levelEmoji = {
        [LogLevel.DEBUG]: '🔍',
        [LogLevel.INFO]: 'ℹ️',
        [LogLevel.WARN]: '⚠️',
        [LogLevel.ERROR]: '❌'
      };

      const content = `**[scheduled-autosnsflow] ${levelEmoji[entry.level]} ${LogLevel[entry.level]}**\n${entry.message}\n時刻: ${entry.timestamp}${entry.userId ? `\nユーザーID: ${entry.userId}` : ''}${entry.data ? `\nデータ: ${JSON.stringify(entry.data, null, 2)}` : ''}${entry.error ? `\nエラー: ${entry.error.message}` : ''}`;
      
      await postDiscord([this.config.masterDiscordWebhook], content);
    } catch (error) {
      console.error('Discordログ送信失敗:', error);
    }
  }

  log(level: LogLevel, message: string, userId?: string, data?: any, error?: Error): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      userId,
      data,
      error
    };

    this.logs.push(entry);

    if (this.shouldLog(level)) {
      const formattedLog = this.formatLog(entry);
      console.log(formattedLog);
      
      // CloudWatchログに出力
      if (this.config.logging.enableCloudWatch) {
        // CloudWatchの構造化ログ形式
        console.log(JSON.stringify({
          timestamp: entry.timestamp,
          level: LogLevel[entry.level],
          message: entry.message,
          userId: entry.userId,
          data: entry.data,
          error: entry.error?.message
        }));
      }
    }

    // エラーレベル以上はDiscordに通知
    if (level >= LogLevel.ERROR) {
      this.sendDiscordLog(entry);
    }
  }

  debug(message: string, userId?: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, userId, data);
  }

  info(message: string, userId?: string, data?: any): void {
    this.log(LogLevel.INFO, message, userId, data);
  }

  warn(message: string, userId?: string, data?: any): void {
    this.log(LogLevel.WARN, message, userId, data);
  }

  error(message: string, userId?: string, data?: any, error?: Error): void {
    this.log(LogLevel.ERROR, message, userId, data, error);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }
}
