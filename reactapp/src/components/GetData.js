import React, { useState } from 'react'

const GetData = (props) => {

    const setTextData=props.setTextData;
    const [full, setFull] = useState("false");
    const PORT=process.env.REACT_APP_BACKEND_PORT | process.env.PORT+2000;


    const handleOnClick = async(e) => {
        e.preventDefault();
        try{
            const result=await fetch(`http://localhost:${PORT}/getweights`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }, 
                body: JSON.stringify({full})
            });
            const data=await result.json();
            console.log(data);
            const jsonData = JSON.stringify(data.records);
            setTextData("Your info: "+jsonData);
        }
        catch(err){
            console.log(err);
            setTextData("Unable fetch your info");
        }
    }

    return (
        <div className='m-3'>
            <form className='form'>
                <div className='form-group m-3'>
                    <label>Weight Display options</label>
                    <select className="form-control" onChange={(e)=>setFull(e.target.value)}>
                        <option value="false">First Layer</option>
                        <option value="true">Full Data</option>
                        <option value="no">No weights</option>
                    </select>
                </div>
            </form>
            <div className="btn btn-primary mx-3 mt-1" onClick={handleOnClick}>Get your info</div>
        </div>
    )
}

export default GetData