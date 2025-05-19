import { EventEmitter } from 'events';
import readline from 'readline';
import chalk from 'chalk';

// Job status enum
enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Job interface
interface Job {
  id: string;
  name: string;
  status: JobStatus;
  logs: string[];
}

// Flow interface
interface Flow {
  id: string;
  name: string;
  jobs: Job[];
  currentJobIndex: number;
  displayStartLine?: number; // Track where this flow is displayed in console
  displayLines?: number; // How many lines this flow takes up in console
}

class FlowLogger extends EventEmitter {
  private flows: Map<string, Flow> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIndex = 0;
  private totalDisplayLines = 0;
  private isFirstRender = true;

  constructor() {
    super();
    // Start rendering immediately when instantiated
    this.startRendering();
  }

  /**
   * Initialize a new flow
   */
  public initFlow(name: string, jobNames: string[]): string {
    const flowId = `flow-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const jobs: Job[] = jobNames.map((jobName, index) => ({
      id: `job-${flowId}-${index}`,
      name: jobName,
      status: index === 0 ? JobStatus.RUNNING : JobStatus.PENDING,
      logs: [],
    }));

    const flow: Flow = {
      id: flowId,
      name,
      jobs,
      currentJobIndex: 0,
      displayStartLine: this.totalDisplayLines,
    };

    // Calculate lines this flow will take
    flow.displayLines = 2 + flow.jobs.length; // Header + blank line + one line per job
    this.totalDisplayLines += flow.displayLines;

    // Store the new flow
    this.flows.set(flowId, flow);

    // Render the flow
    if (this.isFirstRender) {
      this.renderFlowsInitial();
      this.isFirstRender = false;
    } else {
      this.renderFlows();
    }

    return flowId;
  }

  /**
   * First time rendering of all flows (without clearing lines)
   */
  private renderFlowsInitial(): void {
    console.clear();
    // Sort flows by their display order
    const sortedFlows = Array.from(this.flows.values()).sort(
      (a, b) => (a.displayStartLine || 0) - (b.displayStartLine || 0),
    );

    for (const flow of sortedFlows) {
      // Flow header
      console.log(chalk.bold.cyan(`\n${flow.name}`));

      // Render all jobs
      flow.jobs.forEach((job, index) => {
        const statusIcon = this.getJobStatusIcon(job.status);
        console.log(`${statusIcon} ${job.name}`);

        // Show logs only for the current running job
        if (index === flow.currentJobIndex && job.status === JobStatus.RUNNING) {
          if (job.logs.length > 0) {
            console.log(chalk.gray('  ' + job.logs[job.logs.length - 1]));
            flow.displayLines = (flow.displayLines || 0) + 1;
            this.totalDisplayLines++;
          }
        }
      });
    }
  }

  /**
   * Get icon for job status
   */
  private getJobStatusIcon(status: JobStatus): string {
    switch (status) {
      case JobStatus.COMPLETED:
        return chalk.green('✓');
      case JobStatus.FAILED:
        return chalk.red('✗');
      case JobStatus.RUNNING:
        return chalk.yellow(this.spinnerFrames[this.spinnerIndex]);
      case JobStatus.PENDING:
        return chalk.gray('○');
      default:
        return '';
    }
  }

  /**
   * Add a log to a specific flow's current running job
   */
  public log(flowId: string, message: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    const currentJob = flow.jobs[flow.currentJobIndex];
    if (currentJob) {
      currentJob.logs.push(message);

      // Add an extra line if this is the first log
      if (currentJob.logs.length === 1) {
        flow.displayLines = (flow.displayLines || 0) + 1;
        this.totalDisplayLines++;

        // Update display start lines for all flows after this one
        this.updateFlowDisplayPositions();
      }
    }
  }

  /**
   * Mark the current job as completed and move to the next one
   */
  public completeCurrentJob(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    const currentJob = flow.jobs[flow.currentJobIndex];
    if (currentJob) {
      // Check if this job had logs (we need to account for display line changes)
      const hadLogs = currentJob.logs.length > 0;

      currentJob.status = JobStatus.COMPLETED;
      currentJob.logs = []; // Clear logs when job completes

      // Move to the next job if available
      if (flow.currentJobIndex < flow.jobs.length - 1) {
        flow.currentJobIndex++;
        flow.jobs[flow.currentJobIndex].status = JobStatus.RUNNING;
      } else {
        // All jobs completed
        this.emit('flowCompleted', flow.id);
      }

      // Update display lines if needed
      if (hadLogs) {
        flow.displayLines = (flow.displayLines || 0) - 1;
        this.totalDisplayLines--;
        this.updateFlowDisplayPositions();
      }
    }
  }

  /**
   * Mark the current job as failed
   */
  public failCurrentJob(flowId: string, errorMessage?: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    const currentJob = flow.jobs[flow.currentJobIndex];
    if (currentJob) {
      currentJob.status = JobStatus.FAILED;
      if (errorMessage) {
        currentJob.logs.push(chalk.red(`Error: ${errorMessage}`));

        // If this is the first log, account for the extra line
        if (currentJob.logs.length === 1) {
          flow.displayLines = (flow.displayLines || 0) + 1;
          this.totalDisplayLines++;
          this.updateFlowDisplayPositions();
        }
      }

      this.emit('flowFailed', flow.id, currentJob.id);
    }
  }

  /**
   * Remove a flow from tracking
   */
  public removeFlow(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    // Account for the lines this flow was taking up
    this.totalDisplayLines -= flow.displayLines || 0;

    // Remove the flow
    this.flows.delete(flowId);

    // Update positions of other flows
    this.updateFlowDisplayPositions();

    // If no more flows, stop rendering
    if (this.flows.size === 0) {
      this.stopRendering();
    }
  }

  /**
   * Update display positions for all flows after layout changes
   */
  private updateFlowDisplayPositions(): void {
    let currentLine = 0;

    // Sort flows by their current display position
    const sortedFlows = Array.from(this.flows.entries()).sort(
      ([_, a], [__, b]) => (a.displayStartLine || 0) - (b.displayStartLine || 0),
    );

    // Reassign positions
    for (const [flowId, flow] of sortedFlows) {
      flow.displayStartLine = currentLine;
      currentLine += flow.displayLines || 0;
    }
  }

  /**
   * Start the flow rendering loop
   */
  private startRendering(): void {
    if (this.intervalId) return; // Already rendering

    this.intervalId = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      if (this.flows.size > 0) {
        this.renderFlows();
      }
    }, 80);
  }

  /**
   * Render all flows to the console
   */
  private renderFlows(): void {
    if (this.flows.size === 0) return;

    // Move cursor to the beginning of the display area
    readline.moveCursor(process.stdout, 0, -this.totalDisplayLines);

    // Sort flows by their display order
    const sortedFlows = Array.from(this.flows.values()).sort(
      (a, b) => (a.displayStartLine || 0) - (b.displayStartLine || 0),
    );

    // Render each flow
    for (const index in sortedFlows) {
      const flow = sortedFlows[index];

      // Clear line and render flow header
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log('');
      console.log(chalk.bold.cyan(`${flow.name}              `));

      // Render jobs
      for (let i = 0; i < flow.jobs.length; i++) {
        const job = flow.jobs[i];
        const statusIcon = this.getJobStatusIcon(job.status);

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${statusIcon} ${job.name}`);

        // Show logs for running job
        if (i === flow.currentJobIndex && job.status === JobStatus.RUNNING && job.logs.length > 0) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          console.log(chalk.gray('  ' + job.logs[job.logs.length - 1]));
        }
      }
    }
  }

  /**
   * Stop the rendering loop
   */
  private stopRendering(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// Example usage showing concurrent flows
async function example() {
  const logger = new FlowLogger();

  // Initialize first flow
  const flowId1 = logger.initFlow('Flow 1', ['Fetch Data', 'Transform Data', 'Save Results']);

  // Wait a bit before starting the second flow
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Initialize second flow (runs concurrently)
  const flowId2 = logger.initFlow('Flow 2', [
    'Load Images',
    'Apply Filters',
    'Generate Thumbnails',
  ]);

  // Run both flows concurrently
  const runFlow1 = async () => {
    // Job 1
    logger.log(flowId1, 'Connecting to API...');
    await new Promise((resolve) => setTimeout(resolve, 800));
    logger.log(flowId1, 'Downloading data...');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    logger.log(flowId1, 'Downloaded 3.2MB of data');
    await new Promise((resolve) => setTimeout(resolve, 500));
    logger.completeCurrentJob(flowId1);

    // Job 2
    logger.log(flowId1, 'Parsing JSON data...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.log(flowId1, 'Applying transformations...');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    logger.completeCurrentJob(flowId1);

    // Job 3
    logger.log(flowId1, 'Connecting to database...');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    logger.log(flowId1, 'Writing records...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.completeCurrentJob(flowId1);

    // Clean up when done
    setTimeout(() => logger.removeFlow(flowId1), 1000);
  };

  const runFlow2 = async () => {
    // Job 1
    logger.log(flowId2, 'Loading 12 images...');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    logger.log(flowId2, 'Verifying formats...');
    await new Promise((resolve) => setTimeout(resolve, 800));
    logger.completeCurrentJob(flowId2);

    // Job 2
    logger.log(flowId2, 'Applying blur filter...');
    await new Promise((resolve) => setTimeout(resolve, 700));
    logger.log(flowId2, 'Applying color correction...');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    logger.completeCurrentJob(flowId2);

    // Job 3
    logger.log(flowId2, 'Generating thumbnails...');
    await new Promise((resolve) => setTimeout(resolve, 1800));
    logger.log(flowId2, 'Optimizing images...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.completeCurrentJob(flowId2);

    // Clean up when done
    setTimeout(() => logger.removeFlow(flowId2), 1000);
  };

  // Run both flows
  await Promise.all([runFlow1(), runFlow2()]);
}

// Uncomment to run the example
//example();

export { FlowLogger, JobStatus };
