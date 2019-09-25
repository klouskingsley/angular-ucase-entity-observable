import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';



import { AppComponent } from './app.component';
import { CommentComponent } from './comment/comment.component'
import { DefaultStrategyComponent } from './default-strategy/default-strategy.component'

import {CommentUcase} from './comment/comment.ucase'
import {CommentWsEntity} from './comment/comment-ws.entity'

@NgModule({
  imports:      [ BrowserModule, FormsModule ],
  declarations: [ AppComponent, CommentComponent, AComponent ],
  bootstrap:    [ AppComponent ],
  providers: [CommentUcase, CommentWsEntity],
})
export class AppModule { }
