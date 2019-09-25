import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';

@Component({
  selector: 'app-default-strategy',
  template: `
    <div style="border: 1px solid red; margin: 10px;">DefaultStrategyComponent, 渲染次数 {{renderTimes}}</div>
  `,
  styles: [`h1 { font-family: Lato; }`]
})
export class DefaultStrategyComponent {

  private times: number = 0

  get renderTimes () {
    // this.times++
    console.log('DefaultStrategyComponent rendered')
    return this.times
  }
}