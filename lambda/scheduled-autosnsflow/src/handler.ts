// /lambda/scheduled-autosnsflow/src/handler.ts
// 拡張された定期実行処理：複数タスクの実行と管理
import { TaskScheduler, ScheduleEvent, ExecutionResult } from "./scheduler";

type EventLike = ScheduleEvent & { 
  userId?: string;
  scheduleName?: string;
  taskType?: string;
  customData?: any;
};

export const handler = async (event: EventLike = {}): Promise<ExecutionResult> => {
  try {
    // スケジューラーの初期化
    const scheduler = new TaskScheduler();
    
    // イベントからスケジュール情報を抽出
    const scheduleEvent: ScheduleEvent = {
      scheduleName: event.scheduleName,
      userId: event.userId,
      taskType: event.taskType,
      customData: event.customData
    };
    
    // タスクの実行
    const result = await scheduler.execute(scheduleEvent);
    
    return result;
  } catch (error) {
    // エラーハンドリング
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Lambda実行エラー:', errorMessage);
    
    return {
      success: false,
      executedTasks: [],
      results: {},
      errors: [errorMessage],
      executionTime: 0
    };
  }
};
