import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';

@Component({
  selector: 'app-default-strategy',
  template: `
    <div style="border: 1px solid red; margin: 10px;">component a, 渲染次数 {{renderTimes}}</div>
  `,
  styles: [`h1 { font-family: Lato; }`]
})
export class DefaultStrategyComponent {

  private times: number = 0

  get renderTimes () {
    // this.times++
    console.log('component a rendered')
    return this.times
  }
}