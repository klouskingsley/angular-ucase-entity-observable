import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';

@Component({
  selector: 'app-a',
  template: `
    <div style="border: 1px solid red; margin: 10px;">component a</div>
  `,
  styles: [`h1 { font-family: Lato; }`]
})
export class AComponent {
  get isRendered () {
    console.log('component a rendered')
    return false
  }
}