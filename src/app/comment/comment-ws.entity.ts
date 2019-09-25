import {Injectable} from '@angular/core'
import {Subject} from 'rxjs'
import {CommentItem} from './comment.d'
import {COMMENT_MESSAGE_TYPE} from './comment.config'


/**
 * 模拟websocket订阅
 */

@Injectable({
  providedIn: 'root'
})
export class CommentWsEntity {

  // 提供subject对象，供usecase订阅新评论
  public newComment$: Subject<CommentItem> = new Subject()

  private messageHandler: EventListener

  // 开始接收新评论
  startReceiveNewComment () {
    this.messageHandler = (event: any) => {
      const data = event.data
      if (data.type === COMMENT_MESSAGE_TYPE) {
        this.newComment$.next(data.data)
      }
    }

    window.addEventListener('message', this.messageHandler)
  }

  // 结束接收新评论
  stopReceiveNewComment () {
    window.removeEventListener('message', this.messageHandler)
    this.messageHandler = null
  }

}