import { Component, Input, OnInit, OnDestroy, NgZone, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-onpush-strategy',
  template: `
    <div style="border: 1px solid red; margin: 10px;">OnpushStrategyComponent, 渲染次数 {{renderTimes}}</div>
  `,
  styles: [`h1 { font-family: Lato; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnpushStrategyComponent {

  private times: number = 0

  get renderTimes () {
    this.times++
    console.log('OnpushStrategyComponent rendered')
    return this.times
  }
}