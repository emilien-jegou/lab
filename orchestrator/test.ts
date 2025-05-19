import chalk, { ChalkInstance } from 'chalk';
import { createLogUpdate } from 'log-update';

const sleep = (timeout: number) => new Promise((res) => setTimeout(res, timeout));

type Observer<T> = (value: T) => void;

export type Signal<T> = {
  get value(): T;
  set value(value: T);
  subscribe: (observer: Observer<T>) => () => void; // unsubscribe function
};

export const createSignal = <T>(initialValue: T): Signal<T> => {
  let value = initialValue;
  let observers: Observer<T>[] = [];

  const subscribe = (observer: Observer<T>) => {
    observers.push(observer);
    // immediately notify with current value
    observer(value);
    return () => {
      observers = observers.filter((o) => o !== observer);
    };
  };

  return {
    get value() {
      return value;
    },
    set value(newValue: T) {
      if (value === newValue) return;
      value = newValue;
      observers.forEach((observer) => observer(value));
    },
    subscribe,
  };
};


const createLogManager = () => {
  const log = createLogUpdate(process.stdout, {
    showCursor: false
  });

  return { log };
}

type ScriptStatus =
  | { kind: 'cancelled' }
  | { kind: 'pending' }
  | { kind: 'ongoing', last?: string }
  | { kind: 'success' }
  | { kind: 'failure', error: string };


type Log = {
  kind: 'log' | 'info' | 'warn' | 'debug' | 'error'
  content: string;
}

type ScriptLog<N extends string = string> = {
  name: N;
  logs: Log[];
  status: ScriptStatus;
};

type FlowLog<N extends string = string> = {
  name: string;
  scripts: ScriptLog<N>[];
};

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const spinnerFrameMs = 30;

const getSpinnerFrame = () => {
  const index = Math.floor(Date.now() / spinnerFrameMs) % spinnerFrames.length;
  return spinnerFrames[index];
}


const getStatusIcon = (status: ScriptStatus['kind']) => {
  switch (status) {
    case 'cancelled': return '-';
    case 'pending': return '○';
    case 'ongoing': return getSpinnerFrame();
    case 'success': return '✔';
    case 'failure': return '❌';
  }
}

const getStatusColor = (status: ScriptStatus['kind']): ChalkInstance => {
  switch (status) {
    case 'cancelled': return chalk.grey;
    case 'pending': return chalk.grey;
    case 'ongoing': return chalk.white;
    case 'success': return chalk.green;
    case 'failure': return chalk.red;
  }
}

const formatFlows = (flows: FlowLog[]): string => {
  let buffer = '';
  for (let index in flows) {
    if (Number(index) !== 0) {
      buffer += '\n';
    }
    const flow = flows[index]
    //const flowStatus = getFlowStatus(flow.scripts);
    //const flowStatusIcon = getStatusIcon(flowStatus);
    // make this bold and blue
    buffer += chalk.blue.bold(`${flow.name}\n`);

    for (let script of flow.scripts) {
      const scriptStatusIcon = getStatusIcon(script.status.kind);
      const c = getStatusColor(script.status.kind);
      buffer += c(`  ${scriptStatusIcon} ${script.name}\n`);
      if (script.status.kind === 'ongoing' && script.status.last?.length) {
        buffer += chalk.grey(`    › ${script.status.last}\n`);
      }
    }

  }

  return buffer;
}

//⠇ Task 0
//  ✔ Script 1
//  ⠦ Script 2
//    › Preparing
//  ○


type FlowLoggerContext = {
  registerFlow(flow: FlowLog): void;
  redraw(): void;
}

const createScriptLogger = (ctx: FlowLoggerContext) => <N extends string = string>(script: ScriptLog<N>) => {

  const wrapper = (kind: Log['kind']) => (text: string) => {
    script.logs.push({ kind, content: text });
    if (script.status.kind === 'ongoing') {
      script.status.last = text;
    }
  };


  const updateStatus = (status: ScriptStatus) => {
    script.status = status;
  }

  return {
    log: wrapper('log'),
    warn: wrapper('warn'),
    debug: wrapper('debug'),
    error: wrapper('error'),
    info: wrapper('info'),
    updateStatus,
  }
}

const createFlowLogger = (ctx: FlowLoggerContext) => <N extends string = string>(flow: FlowLog<N>) => {
  ctx.registerFlow(flow);
  const scriptLoggerCreator = createScriptLogger(ctx);

  const script = (name: N) => {
    const s = flow.scripts.find((script) => script.name === name);
    if (!s) throw new Error('script not found');
    const logger = scriptLoggerCreator(s);
    return logger;
  }

  return { script }
}

const createOrchestratorLogger = () => {
  const { log } = createLogManager();
  let flows: FlowLog[] = [];

  const registerFlow = (flow: FlowLog) => {
    flows.push(flow);
  }

  const redraw = () => {
    const res = formatFlows(flows);
    log(res);
  }

  setInterval(() => {
    redraw();
  }, spinnerFrameMs);
  const flow = createFlowLogger({ registerFlow, redraw });

  return { flow }

}

const logManager = createOrchestratorLogger();

const flowLogger = logManager.flow({
  name: 'Flow 1', scripts: [
    { name: 'Script 1', logs: [], status: { kind: 'pending' } },
    { name: 'Script 2', logs: [], status: { kind: 'pending' } },
    { name: 'Script 3', logs: [], status: { kind: 'pending' } },
  ]
});

let logger = flowLogger.script('Script 1');

logger.updateStatus({ kind: 'ongoing' });
logger.log('Just logging some stuff');
await sleep(800);
logger.log('writing to database');
await sleep(800);
logger.log('Finishing it up');
await sleep(800);
logger.updateStatus({ kind: 'success' });

const flowLogger2 = logManager.flow({
  name: 'Flow 2', scripts: [
    { name: 'F-Script 1', logs: [], status: { kind: 'pending' } },
    { name: 'F-Script 2', logs: [], status: { kind: 'pending' } },
  ]
});

let logger2 = flowLogger2.script('F-Script 1');
logger2.updateStatus({ kind: 'ongoing' });

logger = flowLogger.script('Script 2');
logger.updateStatus({ kind: 'ongoing' });
logger.log('Just logging some stuff');
await sleep(800);
logger.log('writing to database');
await sleep(800);
logger.log('Finishing it up');
await sleep(800);
logger.updateStatus({ kind: 'success' });

logger = flowLogger.script('Script 3');
logger.updateStatus({ kind: 'ongoing' });
logger.log('Just logging some stuff');
await sleep(800);
logger.log('writing to database');
await sleep(800);
logger.log('Finishing it up');
await sleep(800);
logger.updateStatus({ kind: 'success' });

//// Usage example:
//const display = new ReservedLines(5);
//
//// Update individual lines as needed
//display.updateLine(0, 'Line 1: Status: Running');
//display.updateLine(2, 'Line 3: Progress: 25%');
//
//// Later on, update with new information
//setTimeout(() => {
//  display.updateLine(2, 'Line 3: Progress: 50%');
//}, 1000);
//
//setTimeout(() => {
//  display.updateLine(0, 'Line 1: Status: Completed');
//  display.updateLine(2, 'Line 3: Progress: 100%');
//  display.updateLine(4, 'Line 5: All tasks completed successfully!');
//}, 2000);

// Your tasks with subtasks would look like:
// const tasks = new Listr([], {
//   concurrent: true, // Run both flows concurrently
//   exitOnError: false, // Continue with Flow 2 even if Flow 1 fails
//   rendererOptions: {
//     showErrorMessage: true,
//     formatOutput: 'wrap',
//   },
//   collectErrors: false, // Collect errors for reporting at the end
// });


//DraftLog.into(console);
//
//function someAsyncFunction(){ 
//  var TAG = '[someAsyncFunction]'
//  var log = console.draft(TAG, 'init')
//
//  function a() {
//    setTimeout(() => {
//      log(TAG, 'calling b')
//      b()
//    }, 500)
//  }
//
//  function b() {
//    setTimeout(() => {
//      log(TAG, 'finished')
//    })
//  }
//  a();
//}
//
//someAsyncFunction();
//someAsyncFunction();
//someAsyncFunction();
//
//// Prints a clock incrementing one every second in the same line
//var draft = console.draft()
//var elapsed = 1
//setInterval( () => {
//  draft('Elapsed', elapsed++, 'seconds')
//}, 1000)
//
//console.log('It doesn`t matter')
//console.log('How \n many \n lines \n it uses')
//
//for (let it in Array.from({ length: 10 })) {
//  await sleep(5000);
//}
//
//#const { Listr } = require('listr2');
//#
//#// Your tasks with subtasks would look like:
//#const tasks = new Listr([
//#  {
//#    title: 'Flow 1',
//#    task: () => {
//#      return new Listr([
//#        {
//#          title: 'Fetch Data',
//#          task: async(ctx, task) => {
//#            task.output = 'Connecting to API...';
//#            await new Promise((r) => setTimeout(r, 800));
//#            task.output = 'Downloading data...';
//#            await new Promise((r) => setTimeout(r, 1200));
//#            task.output = 'Downloaded 3.2MB of data';
//#          }
//#        },
//#        {
//#          title: 'Transform Data',
//#          task: async(ctx, task) => {
//#            task.output = 'Parsing JSON data...';
//#            await new Promise((r) => setTimeout(r, 1000));
//#            task.output = 'Applying transformations...';
//#            await new Promise((r) => setTimeout(r, 1500));
//#          }
//#        },
//#        {
//#          title: 'Save Results',
//#          task: async(ctx, task) => {
//#            task.output = 'Connecting to database...';
//#            await new Promise((r) => setTimeout(r, 1200));
//#            task.output = 'Writing records...';
//#            await new Promise((r) => setTimeout(r, 400));
//#            // Intentionally fail this task
//#            throw new Error('Database connection lost');
//#          }
//#        }
//#], {
//#        // Options for this nested list
//#        exitOnError: true, // Stop Flow 1 if any task fails
//#        rendererOptions: { 
//#          collapse: false,
//#          collapseErrors: false,
//#          showSubtasks: true
//#
//}
//#      });
//#    },
//#    // Error handling at the flow level
//#    exitOnError: false // Don't stop other flows if this one fails
//#  },
//#  {
//#    title: 'Flow 2',
//#    task: () => {
//#      return new Listr([
//#        {
//#          title: 'Load Images',
//#          task: async(ctx, task) => {
//#            task.output = 'Loading 12 images...';
//#            await new Promise((r) => setTimeout(r, 1500));
//#            task.output = 'Verifying formats...';
//#            await new Promise((r) => setTimeout(r, 800));
//#          }
//#        },
//#        {
//#          title: 'Apply Filters',
//#          task: async (ctx, task) => {
//#            task.output = 'Applying blur filter...';
//#            await new Promise((r) => setTimeout(r, 700));
//#            task.output = 'Applying color correction...';
//#            await new Promise((r) => setTimeout(r, 1300));
//#
//    }
//#
//  },
//#        {
//#          title: 'Generate Thumbnails',
//#          task: async (ctx, task) => {
//#            task.output = 'Generating thumbnails...';
//#            await new Promise((r) => setTimeout(r, 1800));
//#            task.output = 'Optimizing images...';
//#            await new Promise((r) => setTimeout(r, 1000));
//#
//    }
//#
//  }
//#      ], {
//#        // Options for this nested list
//#        rendererOptions: { 
//#          collapse: false,
//#          showSubtasks: true
//#
//    }
//#
//  });
//#
//}
//#  }
//#], { 
//#  concurrent: true,  // Run both flows concurrently
//#  exitOnError: false, // Continue with Flow 2 even if Flow 1 fails
//#  rendererOptions: {
//#    showErrorMessage: true,
//#    formatOutput: 'wrap'
//#
//  },
//#  collectErrors: true // Collect errors for reporting at the end
//#
//});
//#
//#// Create a context to store task data and errors
//#const context = {};
//#
//#// Run the tasks
//#tasks.run(context)
//#.then(ctx => {
//#    console.log('Completed tasks with context:', ctx);
//#
//})
//#.catch(err => {
//#    console.error('Error executing tasks:');
//#    
//#    // If we collected errors, display them nicely
//#    if (err.context && err.context.errors) {
//#      console.log('\nDetailed errors:');
//#      err.context.errors.forEach((error, index) => {
//#        console.log(`Error ${index + 1}: ${error.message}`);
//#        if (error.stack) {
//#          console.log(`Stack: ${error.stack.split('\n')[0]}`);
//#
//  }
//#
//});
//#
//  } else {
//#      console.error(err.message);
//#
//  }
//#
//});
