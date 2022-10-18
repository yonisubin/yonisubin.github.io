$(document).ready(function(){
    window.addEventListener("keydown", function(e) {
        if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.code) > -1) {
            e.preventDefault();
        }
    }, false);
    var started=false;
    var canvas=document.getElementById("snake-canvas");
    var context=canvas.getContext("2d");
    context.font="24px serif"
    context.strokeText("click in the frame to start...",125,250);
    $("#snake-canvas").click(function(){
        context.clearRect(0,0,canvas.width,canvas.height);
        if(!started)
            game();
    });
    $("#reset-snake").click(function(){
        console.log("reset");
        window.location.reload();
    });
    function game(){
        started=true;
        var width=50, height=50
        var snake={
            length:3,
            x:250,
            y:250,
            dir:"u",
            pos:[[25,25],[25,26],[25,27]],
            points:0,
            extend:0,
            advance:function(){
                if(!started) return ;
                console.log("***********************");
                if(snake.extend==0){
                    snake.pos.pop();
                }else{
                    snake.extend--;
                }
                if(snake.dir=="u"){
                    snake.pos.unshift([snake.pos[0][0],snake.pos[0][1]-1]);
                }else if(snake.dir=="d"){
                    snake.pos.unshift([snake.pos[0][0],snake.pos[0][1]+1]);
                }else if(snake.dir=="l"){
                    snake.pos.unshift([snake.pos[0][0]-1,snake.pos[0][1]]);
                }else if(snake.dir=="r"){
                    snake.pos.unshift([snake.pos[0][0]+1,snake.pos[0][1]]);
                }

                console.log(snake.pos);
                var collided=false;
                for(i=0;i<snake.pos.length;i++){
                    for(j=0;j<i;j++){
                        if(snake.pos[i][0]==snake.pos[j][0]&&snake.pos[i][1]==snake.pos[j][1]){
                            collided=true;
                        }
                    }
                }
                if(collided){
                    alert("You lose! You collided with yourself!");
                    started=false;
                    // snake.pos=[[25,25],[25,26],[25,27]];
                }
                if(snake.pos[0][0]<0||snake.pos[0][0]>=width||snake.pos[0][1]<0||snake.pos[0][1]>=height){
                    alert("You Lose! You went out of bounds!");
                    started=false;
                    // snake.pos=[[25,25],[25,26],[25,27]];
                }
                // console.log(snake.extend);
                for(i=0;i<apples.length;i++){
                    for(j=0;j<snake.pos.length;j++){
                        if(snake.pos[j][0]==apples[i].pos[0]&&snake.pos[j][1]==apples[i].pos[1]){
                            generateApple(snake,apples);
                            snake.points+=apples[i].val;
                            snake.extend+=apples[i].val;
                            apples.splice(i,1);
                        }
                    }
                }
                draw(snake,apples);
            }
            // occupiesSpot:function(spot){
            //     for(i=0;i<this.pos;i++){
            //         if(this.pos[i]==spot) return true;
            //     }
            //     return false;
            // }
        };
        // console.log(snake.pos);
        // snake.pos=[[25,25],[25,26],[25,27]];
        setInterval(snake.advance,100);
        $(document).keydown(function(e){
            // alert("Here")
            if(e.keyCode==37&&snake.dir!="r"){
                snake.dir="l";
            }else if(e.keyCode==39&&snake.dir!="l"){
                snake.dir="r";
            }else if(e.keyCode==38&&snake.dir!="d"){
                snake.dir="u";
            }else if(e.keyCode==40&&snake.dir!="u"){
                snake.dir="d";
            // }else if(e.keyCode==65){
            //     p=[]
            //     for(i=0;i<apples.length;i++){
            //         p.unshift(apples[i].pos);
            //     }
                // alert(p);
                // alert(snake.pos);
                // console.log("#############################")
            }
        });
        var apples=[]
        for(i=0;i<3;i++) generateApple(snake,apples);
        draw(snake,apples);
        function generateApple(snake,apples){
            x=Math.floor(Math.random()*width);
            y=Math.floor(Math.random()*height);
            val=Math.floor(Math.random()*5+1);
            // while(snake.occupiesSpot([x,y])){
            //     x=Math.floor(Math.random()*width);
            //     y=Math.floor(Math.random()*height);
            // }
            apples.push({pos:[x,y],val:val});
        }
        function draw(snake, apples){
            context.clearRect(0,0,canvas.width,canvas.height);
            context.fillStyle="black";
            for(i=0;i<snake.pos.length;i++){
                context.fillRect(snake.pos[i][0]*10,snake.pos[i][1]*10,10,10);
            }
            context.fillStyle="green";
            for(i=0;i<apples.length;i++){
                context.fillRect(apples[i].pos[0]*10,apples[i].pos[1]*10,10,10);
            }
        }
    }
});