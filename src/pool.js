"use strict";

import { Semaphore } from "async-mutex";

/**
 * Pool
 */
export class Pool {
  constructor(factory, options) {
    this.factory = factory;
    this.min = options.min || 1;
    this.max = options.max || 5;
    this.idleTimeout = options.idleTimeout || 60000; // 1 mins
    this.idleIntervalCheck = options.idleIntervalCheck || 10000; // 10 seconds
    this.resources = [];
    this.semaphore = new Semaphore(this.max);

    this.initResource();
    this.createIdleCheck();
  }

  initResource() {
    for (let index = 0; index < this.min; index++) {
      this.resources.push({
        ...this.factory.create(),
        lastUsed: Date.now(),
        inUsed: false,
        canDestroy: false,
      });
    }
  }

  createIdleCheck() {
    setInterval(() => {
      this.resources = this.resources.filter((resource) => {
        if (
          resource.canDestroy === true &&
          resource.inUsed === false &&
          Date.now() - resource.lastUsed > this.idleTimeout
        ) {
          this.factory.destroy(resource);

          return false;
        } else {
          return true;
        }
      });
    }, this.idleIntervalCheck);
  }

  async acquire() {
    await this.semaphore.acquire();

    if (this.resources.length > 0) {
      const resource = this.resources.pop();

      resource.lastUsed = Date.now();
      resource.inUsed = true;

      return resource;
    } else {
      return {
        ...this.factory.create(),
        lastUsed: Date.now(),
        inUsed: false,
        canDestroy: true,
      };
    }
  }

  release(resource) {
    if (resource !== undefined) {
      resource.lastUsed = Date.now();
      resource.inUsed = false;

      this.resources.push(resource);
    }

    this.semaphore.release();
  }
}
