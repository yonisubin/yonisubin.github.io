$(document).ready(function(){
    $("#sudoku-solve").click(function(){
        var puzzle=readPuzzle();
        var solution=solve(puzzle);
        console.log(solution);
        fillSolution(solution);
        function readPuzzle(){
            var puzzle=[[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,0,0]];
            var p=$(".sudoku-number");
            for(i=0;i<p.length;i++){
                if(parseInt(p[i].value)){
                    puzzle[Math.floor(i/9)][i%9]=parseInt(p[i].value);
                }
            }
            return puzzle
        }
        function checkPos(puzzle, r, c){
            var seen=[];
            for(i=0;i<9;i++){
                if(seen.indexOf(puzzle[i][c])>=0 && puzzle[i][c]!=0){
                    return false;
                }else{
                    seen.push(puzzle[i][c]);
                }
            }
            seen=[];
            for(i=0;i<9;i++){
                if(seen.indexOf(puzzle[r][i])>=0 && puzzle[r][i]!=0){
                    return false;
                }else{
                    seen.push(puzzle[r][i]);
                }
            }
            seen=[];
            console.log(r,c);
            if (0<=r&&r<=2 && 0<=c&&c<=2){
                // top left
                console.log(1);
                seen.push(puzzle[0][0])
                seen.push(puzzle[0][1])
                seen.push(puzzle[0][2])
                seen.push(puzzle[1][0])
                seen.push(puzzle[1][1])
                seen.push(puzzle[1][2])
                seen.push(puzzle[2][0])
                seen.push(puzzle[2][1])
                seen.push(puzzle[2][2])
            }else if (0<=r&&r<=2 && 3<=c&&c<=5){
                // top middle
                console.log(2);
                seen.push(puzzle[0][3])
                seen.push(puzzle[0][4])
                seen.push(puzzle[0][5])
                seen.push(puzzle[1][3])
                seen.push(puzzle[1][4])
                seen.push(puzzle[1][5])
                seen.push(puzzle[2][3])
                seen.push(puzzle[2][4])
                seen.push(puzzle[2][5])
            }else if (0<=r&&r<=2 && 6<=c&&c<=8){
                // top right
                console.log(3);
                seen.push(puzzle[0][6])
                seen.push(puzzle[0][7])
                seen.push(puzzle[0][8])
                seen.push(puzzle[1][6])
                seen.push(puzzle[1][7])
                seen.push(puzzle[1][8])
                seen.push(puzzle[2][6])
                seen.push(puzzle[2][7])
                seen.push(puzzle[2][8])
            }else if (3<=r&&r<=5 && 0<=c&&c<=2){
                // middle left
                console.log(4);
                seen.push(puzzle[3][0])
                seen.push(puzzle[3][1])
                seen.push(puzzle[3][2])
                seen.push(puzzle[4][0])
                seen.push(puzzle[4][1])
                seen.push(puzzle[4][2])
                seen.push(puzzle[5][0])
                seen.push(puzzle[5][1])
                seen.push(puzzle[5][2])
            }else if (3<=r&&r<=5 && 3<=c&&c<=5){
                // middle middle
                console.log(5);
                seen.push(puzzle[3][3])
                seen.push(puzzle[3][4])
                seen.push(puzzle[3][5])
                seen.push(puzzle[4][3])
                seen.push(puzzle[4][4])
                seen.push(puzzle[4][5])
                seen.push(puzzle[5][3])
                seen.push(puzzle[5][4])
                seen.push(puzzle[5][5])
            }else if (3<=r&&r<=5 && 6<=c&&c<=8){
                //# middle right
                console.log(6);
                seen.push(puzzle[3][6])
                seen.push(puzzle[3][7])
                seen.push(puzzle[3][8])
                seen.push(puzzle[4][6])
                seen.push(puzzle[4][7])
                seen.push(puzzle[4][8])
                seen.push(puzzle[5][6])
                seen.push(puzzle[5][7])
                seen.push(puzzle[5][8])
            }else if (6<=r&&r<=8 && 0<=c&&c<=2){
                // # bottom left
                console.log(7);
                seen.push(puzzle[6][0])
                seen.push(puzzle[6][1])
                seen.push(puzzle[6][2])
                seen.push(puzzle[7][0])
                seen.push(puzzle[7][1])
                seen.push(puzzle[7][2])
                seen.push(puzzle[8][0])
                seen.push(puzzle[8][1])
                seen.push(puzzle[8][2])
            }else if (6<=r&&r<=8 && 3<=c&&c<=5){
                // bottom middle
                console.log(8);
                seen.push(puzzle[6][3])
                seen.push(puzzle[6][4])
                seen.push(puzzle[6][5])
                seen.push(puzzle[7][3])
                seen.push(puzzle[7][4])
                seen.push(puzzle[7][5])
                seen.push(puzzle[8][3])
                seen.push(puzzle[8][4])
                seen.push(puzzle[8][5])
            }else if (6<=r&&r<=8 && 6<=c&&c<=8){
                //# bottom right
                console.log(9);
                seen.push(puzzle[6][6])
                seen.push(puzzle[6][7])
                seen.push(puzzle[6][8])
                seen.push(puzzle[7][6])
                seen.push(puzzle[7][7])
                seen.push(puzzle[7][8])
                seen.push(puzzle[8][6])
                seen.push(puzzle[8][7])
                seen.push(puzzle[8][8])
            }
            for(i=0;i<seen.length;i++){
                for(j=0;j<i;j++){
                    if(seen[i]==seen[j]&&seen[i]!=0){
                        return false;
                    }
                }
            }
            return true;
        }
        function check_puzzle(puzzle){
            for(r=0;r<puzzle.length;r++){
                for(c=0;c<puzzle[r].length;c++){
                    if(!checkPos(puzzle,r,c))
                        return false;
                }
            }
            return true;
        }
        function is_complete(puzzle){
            for(r=0;r<puzzle.length;r++){
                for(c=0;c<puzzle[r].length;c++){
                    if(puzzle[r][c]==0)
                        return false;
                }
            }
            return true;
        }
        function copy_2d_arry(puzzle){
            var p_copy=[[]];
            for(i=0;i<puzzle.length;i++){
                for(j=0;j<puzzle[i].length;j++){
                    p_copy[i].push(puzzle[i][j]);
                }
                p_copy.push([]);
            }
            p_copy.pop();
            return p_copy;
        }
        function solve(puzzle){
            if(is_complete(puzzle)&&check_puzzle(puzzle)){
                return puzzle;
            }
            var p_copy=copy_2d_arry(puzzle);
            var r=0, c=0, toBreak=false;
            for(row=0;row<puzzle.length;row++){
                for(col=0;col<puzzle[row].length;col++){
                    if(puzzle[row][col]==0){
                        toBreak=true;
                        r=row;
                        c=col;
                        break;
                    }
                }
                if(toBreak) break;
            }
            var row=r, col=c;
            p_copy[row][col]=1;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=2;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=3;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=4;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=5;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=6;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=7;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=8;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=9;
            if (check_puzzle(p_copy)){
                sol=solve(p_copy);
                if (check_puzzle(sol) && is_complete(sol)){
                    return sol;
                }
            }
            p_copy[row][col]=0;
            return p_copy;                  
        }
        function fillSolution(solution){
            var $spots=$(".sudoku-sol-num");
            console.log($spots);
            for(i=0;i<$spots.length;i++){
                $spots[i].innerHTML=solution[Math.floor(i/9)][i%9];
            }
        }
    });
});