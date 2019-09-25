import { Injectable } from '@angular/core'
import { CommentItem } from './comment.d'
import {BehaviorSubject, Subscription} from 'rxjs'
import {CommentHttpEntity} from './comment-http.entity'
import {CommentWsEntity} from './comment-ws.entity'

@Injectable({
  providedIn: 'root'
})
export class CommentUcase {
  public commentList: CommentItem[] = []

  private username: string = '谢豪伟'
  private newCommentSub: Subscription

  constructor (
    private commentHttpEntity: CommentHttpEntity,
    private commentWsEntity: CommentWsEntity
  ) {}

  /**
   * 初始化订阅，组件初始化后调用
   * 
  */
  init () {
    this.newCommentSub = this.commentWsEntity.newComment$.subscribe((commentItem: CommentItem) => {
      this.commentList.unshift(commentItem)
    })
    this.commentWsEntity.startReceiveNewComment()
  }

  /**
   * 
   * 取消订阅，组件卸载后调用
  */
  destroy () {
    this.commentWsEntity.stopReceiveNewComment()
    this.newCommentSub.unsubscribe()
  }

  /**
   * 发送评论
  */
  async sendComment (content: string) {
    await this.commentHttpEntity.sendComment(content, this.username)
  }

  /**
   * 
   * 获取历史评论
  */
  async fetchComment () {
    const commentList: CommentItem[] = await this.commentHttpEntity.getHistoryCommenetList()
    this.commentList = [...this.commentList, ...commentList]
  }

  /**
   * 删除评论
  */
  async deleteComment (commentId: number) {
    await this.commentHttpEntity.deleteComment(commentId)
    this.commentList = this.commentList.filter(commentItem => commentItem.id !== commentId)
  }

  /**
   * 清空评论
  */
  async clearComment () {
    await this.commentHttpEntity.clearComment()
    this.commentList = []
  }
}