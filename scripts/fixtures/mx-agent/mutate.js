const page=pages['3481e002-246e-48e2-b9a5-9af9a82746f0'];
const widget=page.frameLocator('iframe[title="Agent widget"]').frameLocator('iframe').locator('body');
const receipt=await widget.evaluate(()=>mx.mutate('addTask',{taskTitle:'Session task'}));
const snapshot=await widget.evaluate(({receipt})=>{
  return (async()=>{
    const [tasksRead,titleRead]=await Promise.all([mx.read(['tasks'],{wait:true}),mx.read(['taskTitle'])]);
    return {tasks:tasksRead,taskTitle:titleRead};
  })();
},{receipt});
return {receipt, localTasks:snapshot.tasks, taskTitle:snapshot.taskTitle};
