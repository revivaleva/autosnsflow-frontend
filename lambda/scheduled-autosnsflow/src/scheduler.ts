// スケジュール管理とタスク実行制御
import { ScheduledTaskConfig, getConfig } from "./config";
import { executeAccountNotification, executeStatsCollection, executeErrorMonitoring, executeAutoPost, TaskContext } from "./tasks";
import { Logger } from "./logger";

export interface ScheduleEvent {
  scheduleName?: string;
  userId?: string;
  taskType?: string;
  customData?: any;
}

export interface ExecutionResult {
  success: boolean;
  executedTasks: string[];
  results: { [taskName: string]: any };
  errors: string[];
  executionTime: number;
}

export class TaskScheduler {
  private config: ScheduledTaskConfig;
  private logger: Logger;

  constructor(configOverrides?: Partial<ScheduledTaskConfig>) {
    this.config = getConfig(configOverrides);
    this.logger = new Logger(this.config);
  }

  private async executeTask(taskName: string, context: TaskContext): Promise<any> {
    this.logger.info(`タスク実行開始: ${taskName}`, context.userId);
    
    try {
      let result;
      
      switch (taskName) {
        case 'accountNotification':
          result = await executeAccountNotification(context);
          break;
        case 'statsCollection':
          result = await executeStatsCollection(context);
          break;
        case 'errorMonitoring':
          result = await executeErrorMonitoring(context);
          break;
        case 'autoPost':
          result = await executeAutoPost(context);
          break;
        default:
          throw new Error(`未知のタスク: ${taskName}`);
      }
      
      if (result.success) {
        this.logger.info(`タスク完了: ${taskName}`, context.userId, result.data);
      } else {
        this.logger.error(`タスク失敗: ${taskName}`, context.userId, result.data, new Error(result.error));
      }
      
      return result;
    } catch (error) {
      this.logger.error(`タスク実行エラー: ${taskName}`, context.userId, undefined, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private determineTasksToExecute(scheduleName?: string): string[] {
    const tasks: string[] = [];
    
    if (scheduleName) {
      // 特定のスケジュール名に基づいてタスクを決定
      switch (scheduleName) {
        case 'accountNotification':
          if (this.config.tasks.notifyAccounts) tasks.push('accountNotification');
          break;
        case 'autoPost':
          if (this.config.tasks.autoPost) tasks.push('autoPost');
          break;
        case 'statsCollection':
          if (this.config.tasks.collectStats) tasks.push('statsCollection');
          break;
        case 'errorMonitoring':
          if (this.config.tasks.errorMonitoring) tasks.push('errorMonitoring');
          break;
        default:
          // デフォルトでは全タスクを実行
          if (this.config.tasks.notifyAccounts) tasks.push('accountNotification');
          if (this.config.tasks.autoPost) tasks.push('autoPost');
          if (this.config.tasks.collectStats) tasks.push('statsCollection');
          if (this.config.tasks.errorMonitoring) tasks.push('errorMonitoring');
      }
    } else {
      // スケジュール名が指定されていない場合は設定に基づいて全タスクを実行
      if (this.config.tasks.notifyAccounts) tasks.push('accountNotification');
      if (this.config.tasks.autoPost) tasks.push('autoPost');
      if (this.config.tasks.collectStats) tasks.push('statsCollection');
      if (this.config.tasks.errorMonitoring) tasks.push('errorMonitoring');
    }
    
    return tasks;
  }

  async execute(event: ScheduleEvent = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    const userId = event.userId || this.config.defaultUserId;
    const timestamp = new Date().toISOString();
    
    this.logger.info('定期実行開始', userId, { event, config: this.config });
    
    const context: TaskContext = {
      userId,
      config: this.config,
      timestamp
    };
    
    const tasksToExecute = this.determineTasksToExecute(event.scheduleName);
    const results: { [taskName: string]: any } = {};
    const errors: string[] = [];
    const executedTasks: string[] = [];
    
    for (const taskName of tasksToExecute) {
      try {
        this.logger.info(`タスク実行中: ${taskName}`, userId);
        const result = await this.executeTask(taskName, context);
        results[taskName] = result;
        executedTasks.push(taskName);
        
        if (!result.success) {
          errors.push(`${taskName}: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${taskName}: ${errorMessage}`);
        results[taskName] = {
          success: false,
          message: 'タスク実行エラー',
          error: errorMessage
        };
        executedTasks.push(taskName);
      }
    }
    
    const executionTime = Date.now() - startTime;
    const success = errors.length === 0;
    
    const executionResult: ExecutionResult = {
      success,
      executedTasks,
      results,
      errors,
      executionTime
    };
    
    this.logger.info('定期実行完了', userId, {
      success,
      executedTasks,
      executionTime,
      errorCount: errors.length
    });
    
    return executionResult;
  }

  getConfig(): ScheduledTaskConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ScheduledTaskConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger = new Logger(this.config);
    this.logger.info('設定更新完了', undefined, updates);
  }
}
