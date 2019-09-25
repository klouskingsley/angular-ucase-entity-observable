# angular组件开发模式

## 采用ucase/entity模式


ucase/entity通过对功能模块的分层，来简化模块的代码结构。

## 一个模块该如何开发

1. 分析模块的数据来源，形成entity
2. 根据数据来源及接口文档推断出数据类型
3. 分析模块的逻辑及运行时的数据，形成ucase, ucase调用entity
4. 完成组件，组件调用ucase，完成视图和逻辑的连接


## 以一个简单的评论功能为例

假如我们要实现一个评论功能，用户有发送评论，删除评论，清空评论，接收并显示评论这4个功能；
其中发送、删除、清空评论调用后端的http接口，接收评论使用websocket来监听；

- 1. 分析模块的数据来源，形成entity

那么数据来源有两个，一个是http接口，一个是websocket接口；

其中http接口有3个方法，分别是发送评论 (sendComment), 删除评论(deleteComment), 清空评论(clearComment)，获取历史消息(getHistoryComment)可以写成

```ts
// comment-http.entity.ts
class CommentHttpEntity {

  sendComment () {  }

  deleteComment () {  }

  clearComment () {  }

  getHistoryCommenetList () {  }

}
```

websocket有一个接口，开始接收新消息，结束接收新消息

```ts
// comment-ws.entity.ts
class CommentWsEntity {

  startSubNewComment () {}

  stopSubNewComment () {}

}
```

- 2. 根据数据来源及接口文档推断出数据类型

评论有内容，用户名，评论id，所以一条评论的数据结构应该是这样的

```ts
// comment.type.ts
export interface CommentItem {
  id: number;
  username: string;
  content: string;
}
```

与此同时，entity更改为下面这样


```ts
// comment-http.entity.ts
class CommentHttpEntity {

  sendComment (content: string, userName: string): Promise<number> {  }

  deleteComment (commentId: number): Promise<void> {  }

  clearComment (): Promise<void> {  }

  getHistoryCommenetList (): Promise<CommentItem[]> {  }

}
```

websocket有一个接口，开始订阅新消息，结束订阅新消息

```ts
// comment-ws.entity.ts
class CommentWsEntity {

  // 提供subject对象，供usecase订阅新评论
  public newComment$: Subject<CommentItem>

  // 开始接收新评论
  startReceiveNewComment () {}

  // 结束接收新评论
  stopReceiveNewComment () {}

}
```

- 3. 分析模块的逻辑，形成ucase, ucase调用entity

ucase有发送评论，清空评论，删除评论，初次获取评论这些逻辑；
其中运行时的数据为当前页面的评论列表；那么ucae就会是这样

```ts
// comment.ucase.ts

class CommentUcase {
  public commentList: CommentItem[]

  private const username: string = '谢豪伟'
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
```

- 4. 完成组件，组件调用ucase，完成视图和逻辑的连接

组件本身需要处理用户正在输入的数据，所以会有个currentInput，其他数据渲染时直接使用ucase的数据;
其中ucase通过angular的“依赖注入”注入进去。

```ts
@Component({})
export class CommentComponent implements OnInit,OnDestroy {
  private currentInput: string = ''

  constructor (
    private commentUcase: CommentUcase
  ) {}

  ngOnInit () {
    this.commentUcase.fetchComment()
  }

  ngOnDestroy () {
    this.commentUcase
  }

  async sendComment (content: string) {
    await this.commentUcase.sendComment(content)
    this.currentInput = ''
  }

  async clearComment () {
    await this.commentUcase.clearComment()
  }

  async deleteComment (commentId: number) {
    await this.commentUcase.deleteComment(commentId)
  }

}
```

```html
<div>
  <input type="input" [(ngModel)]="currentInput" placeholder="请输入评论内容">

  <div *ngFor="let commentItem of commentUcase.commentList">

    <div>
      {{commentItem.username}}: {{commentItem.content}} <input type="button" value="删除" (click)="deleteComment(commentItem.id)">
    </dvi>
  </div>
</div>
```






