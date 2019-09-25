import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';
import {interval, merge} from 'rxjs';
import {throttle} from 'rxjs/operators';
import {CommentItem} from './comment.d'
import {CommentUcase} from './comment.ucase'


@Component({
  selector: 'app-comment',
  template: `
  <div style="border: 1px solid red">
    <h1>app-comment</h1>

    <div>
      用户名: {{commentUcase.username}}
    </div>
  
    <div>
      输入评论: <input type="input" [(ngModel)]="commentInput">
      <input type="button" (click)="sendComment()" value="发送">
    </div>

    <div>
      <input type="button" (click)="commentUcase.clearComment()" value="清空评论">
    </div>
    <div>
      <h3>评论列表, 个数 {{commentUcase.commentList.length}}</h3>
      <div *ngFor="let comment of commentUcase.commentList" style="padding: 2px;">
        {{comment.username}}: {{comment.content}}
        <span (click)="deleteComment(comment.id)" style="display: inline-block; background: gray; padding: 0 5px; cursor: pointer;">x</span>
      </div>
    </div>
  </div>
  `,
  styles: [`h1 { font-family: Lato; }`]
})
export class CommentComponent implements OnInit, OnDestroy {

  private commentInput: string = ''
  private isTesting: boolean = false
  private commentList: CommentItem[] = []

  constructor (
    private commentUcase: CommentUcase,
    private ngZone: NgZone
  ) {
  }

  ngOnInit () {
    this.commentUcase.init()
  }

  ngOnDestroy () {
    this.commentUcase.destroy()
  }

  sendComment () {
    if (!this.commentInput) {
      alert('请输入评论内容')
      return
    }
    this.commentUcase.sendComment(this.commentInput)
    this.commentInput = ''
  }

  deleteComment (commentId: number) {
    this.commentUcase.deleteComment(commentId)
  }
}
