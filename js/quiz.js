export class QuizEngine {
  constructor({ quiz, questions, timePerQuestion = 15 }) {
    this.quiz = quiz;
    this.questions = questions;
    this.timePerQuestion = Number(timePerQuestion || 15);
    this.currentIndex = 0;
    this.score = 0;
    this.answers = [];
    this.locked = false;
    this.intervalId = null;
    this.timeRemaining = this.timePerQuestion;
    this.startedAt = Date.now();
  }

  get totalQuestions() {
    return this.questions.length;
  }

  getCurrentQuestion() {
    return this.questions[this.currentIndex] ?? null;
  }

  hasNextQuestion() {
    return this.currentIndex < this.totalQuestions - 1;
  }

  getProgressLabel() {
    return `Question ${this.currentIndex + 1} of ${this.totalQuestions}`;
  }

  getProgressPercent() {
    return ((this.currentIndex + 1) / this.totalQuestions) * 100;
  }

  startTimer(onTick, onTimeout) {
    this.clearTimer();
    this.timeRemaining = this.timePerQuestion;

    if (typeof onTick === "function") {
      onTick(this.timeRemaining);
    }

    this.intervalId = window.setInterval(() => {
      this.timeRemaining -= 1;

      if (typeof onTick === "function") {
        onTick(this.timeRemaining);
      }

      if (this.timeRemaining <= 0) {
        this.clearTimer();

        if (typeof onTimeout === "function") {
          onTimeout();
        }
      }
    }, 1000);
  }

  submitAnswer(selectedIndex, { timedOut = false } = {}) {
    if (this.locked) {
      return null;
    }

    this.locked = true;
    this.clearTimer();

    const question = this.getCurrentQuestion();
    const normalizedSelection = Number.isInteger(selectedIndex) ? selectedIndex : null;
    const isCorrect = normalizedSelection === question.correctAnswer;

    if (isCorrect) {
      this.score += 1;
    }

    const answer = {
      questionId: question.id,
      prompt: question.prompt,
      options: question.options,
      selectedIndex: normalizedSelection,
      correctIndex: question.correctAnswer,
      explanation: question.explanation || "",
      timedOut,
      isCorrect
    };

    this.answers.push(answer);

    return {
      answer,
      isCorrect,
      correctIndex: question.correctAnswer,
      selectedIndex: normalizedSelection
    };
  }

  moveNext() {
    if (this.hasNextQuestion()) {
      this.currentIndex += 1;
      this.locked = false;
      return this.getCurrentQuestion();
    }

    return null;
  }

  clearTimer() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  buildResult() {
    const totalQuestions = this.totalQuestions;
    const percentage = totalQuestions ? Math.round((this.score / totalQuestions) * 100) : 0;

    return {
      quiz: {
        id: this.quiz.id,
        title: this.quiz.title,
        category: this.quiz.category,
        description: this.quiz.description || ""
      },
      summary: {
        score: this.score,
        correctAnswers: this.score,
        totalQuestions,
        percentage,
        timePerQuestion: this.timePerQuestion,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - this.startedAt,
        message: getPerformanceMessage(percentage)
      },
      answers: this.answers
    };
  }
}

export function getPerformanceMessage(percentage) {
  if (percentage >= 90) {
    return "Outstanding run. You were fast, accurate, and leaderboard-ready.";
  }

  if (percentage >= 70) {
    return "Strong work. You have the fundamentals down with room to sharpen the edges.";
  }

  if (percentage >= 50) {
    return "Solid effort. Review the missed questions and jump back in for a stronger next round.";
  }

  return "Good start. The review below will help you turn this attempt into a stronger comeback.";
}
