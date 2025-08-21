// 定期実行処理の設定管理
export interface ScheduledTaskConfig {
  // 基本設定
  defaultUserId: string;
  masterDiscordWebhook?: string;
  
  // スケジュール設定
  schedulePatterns: {
    [key: string]: string; // スケジュール名: cron式またはrate式
  };
  
  // 実行タスク設定
  tasks: {
    notifyAccounts: boolean;
    autoPost: boolean;
    collectStats: boolean;
    errorMonitoring: boolean;
  };
  
  // 通知設定
  notifications: {
    discord: boolean;
    slack?: boolean;
    email?: boolean;
  };
  
  // ログ設定
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableCloudWatch: boolean;
    enableDiscordLog: boolean;
  };
}

export const defaultConfig: ScheduledTaskConfig = {
  defaultUserId: process.env.DEFAULT_USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f",
  masterDiscordWebhook: process.env.MASTER_DISCORD_WEBHOOK,
  
  schedulePatterns: {
    accountNotification: "rate(1 hour)",
    autoPost: "rate(30 minutes)",
    statsCollection: "rate(6 hours)",
    errorMonitoring: "rate(15 minutes)"
  },
  
  tasks: {
    notifyAccounts: true,
    autoPost: false,
    collectStats: true,
    errorMonitoring: true
  },
  
  notifications: {
    discord: true,
    slack: false,
    email: false
  },
  
  logging: {
    level: 'info',
    enableCloudWatch: true,
    enableDiscordLog: true
  }
};

export function getConfig(overrides?: Partial<ScheduledTaskConfig>): ScheduledTaskConfig {
  return { ...defaultConfig, ...overrides };
}
